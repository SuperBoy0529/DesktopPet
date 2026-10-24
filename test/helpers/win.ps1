#  Win32 helpers for the integration tests.
#
#  Why EnumWindows instead of .NET's MainWindowHandle: MainWindowHandle points at
#  the process's *main* window, and when the click-through recovery handle is
#  created it can become that window (26x26), so the pet becomes invisible to the
#  tests. EnumWindows + a process-name filter sees every visible window.
#
#  ASCII-only + UTF-8 BOM.

param(
  [ValidateSet('move', 'info', 'list', 'click', 'rclick', 'hotkey')] [string] $Action = 'info',
  [int] $X = 0,
  [int] $Y = 0,
  [string] $Key = 'd'
)

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class PetWin {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetWindowLongW(IntPtr h, int i);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(int flags, int dx, int dy, int data, int extra);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, int flags, IntPtr extra);

  delegate bool EnumProc(IntPtr h, IntPtr p);

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left, Top, Right, Bottom; }

  static bool IsOurs(string name) {
    if (name == null) return false;
    return name.Equals("electron", StringComparison.OrdinalIgnoreCase)
        || name.IndexOf("Worldline", StringComparison.OrdinalIgnoreCase) >= 0;
  }

  public static string[] List() {
    var rows = new List<string>();
    EnumWindows(delegate (IntPtr h, IntPtr p) {
      if (!IsWindowVisible(h)) return true;
      int pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid == 0) return true;
      string name;
      try { name = System.Diagnostics.Process.GetProcessById(pid).ProcessName; }
      catch { return true; }
      if (!IsOurs(name)) return true;

      RECT r;
      if (!GetWindowRect(h, out r)) return true;
      int w = r.Right - r.Left;
      int ht = r.Bottom - r.Top;
      if (w <= 0 || ht <= 0) return true;
      int ex = GetWindowLongW(h, -20);
      rows.Add(String.Format("{0}|{1}|{2}|{3}|{4}|{5}",
        ex, r.Left, r.Top, w, ht, pid));
      return true;
    }, IntPtr.Zero);
    return rows.ToArray();
  }

  public static void Click(int x, int y, bool right) {
    SetCursorPos(x, y);
    System.Threading.Thread.Sleep(60);
    mouse_event(right ? 0x0008 : 0x0002, 0, 0, 0, 0);
    System.Threading.Thread.Sleep(40);
    mouse_event(right ? 0x0010 : 0x0004, 0, 0, 0, 0);
  }

  public static void Move(int x, int y) { SetCursorPos(x, y); }

  public static void Hotkey(byte vk) {
    const int UP = 0x0002;
    keybd_event(0x11, 0, 0, IntPtr.Zero);
    keybd_event(0x12, 0, 0, IntPtr.Zero);
    keybd_event(0x10, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    keybd_event(vk, 0, 0, IntPtr.Zero);
    System.Threading.Thread.Sleep(40);
    keybd_event(vk, 0, UP, IntPtr.Zero);
    keybd_event(0x10, 0, UP, IntPtr.Zero);
    keybd_event(0x12, 0, UP, IntPtr.Zero);
    keybd_event(0x11, 0, UP, IntPtr.Zero);
  }
}
"@

function Get-PetWindows {
  $out = @()
  foreach ($row in [PetWin]::List()) {
    $p = $row -split '\|'
    $ex = [int64]$p[0]
    $out += [pscustomobject]@{
      exStyle = ('0x{0:x}' -f $ex)
      x       = [int]$p[1]
      y       = [int]$p[2]
      w       = [int]$p[3]
      h       = [int]$p[4]
      pid     = [int]$p[5]
    }
  }
  return $out
}

switch ($Action) {
  'hotkey' {
    # Ctrl+Alt+Shift+<Key>：d = 切换穿透，s = 显示/隐藏
    switch (([string]$Key).Trim().ToUpper()) {
      'D' { [PetWin]::Hotkey(0x44) }
      'S' { [PetWin]::Hotkey(0x53) }
      default { [PetWin]::Hotkey(0x44) }
    }
    Write-Output '{"ok":true}'
    break
  }
  'move' {
    [PetWin]::Move($X, $Y)
    Write-Output '{"ok":true}'
    break
  }
  'click' {
    [PetWin]::Click($X, $Y, $false)
    Write-Output '{"ok":true}'
    break
  }
  'rclick' {
    [PetWin]::Click($X, $Y, $true)
    Write-Output '{"ok":true}'
    break
  }
  'list' {
    $w = @(Get-PetWindows)
    if ($w.Count -eq 0) { Write-Output '[]' }
    else { Write-Output (ConvertTo-Json @($w) -Compress) }
    break
  }
  'info' {
    # 桌宠是最大那个窗口；穿透把手只有 26x26，不会被误选
    $w = @(Get-PetWindows) | Sort-Object { $_.w * $_.h } -Descending
    if ($w.Count -eq 0) { Write-Output '{}' }
    else { $w[0] | ConvertTo-Json -Compress }
    break
  }
}
