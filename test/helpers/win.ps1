<#
  集成测试用的 Win32 助手：移动真实光标、读取桌宠窗口的位置与扩展样式。
  用法：
    win.ps1 -Action move -X 120 -Y 240
    win.ps1 -Action info
  输出为一行 JSON。
#>
param(
  [ValidateSet('move', 'info', 'list', 'click', 'rclick', 'hotkey')] [string] $Action = 'info',
  [int] $X = 0,
  [int] $Y = 0,
  [string] $Key = 'd'
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PetWin32 {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLongW(IntPtr h, int index);
  [DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, int flags, IntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@

if ($Action -eq 'hotkey') {
  # 发送 Ctrl+Alt+Shift+<Key>（d = 切换穿透，s = 显示/隐藏）
  $VK_CONTROL = 0x11; $VK_MENU = 0x12; $VK_SHIFT = 0x10
  $KEYUP = 0x0002
  switch (([string]$Key).Trim().ToUpper()) {
    'D' { $VK = 0x44 }
    'S' { $VK = 0x53 }
    default { $VK = 0x44 }
  }
  [PetWin32]::keybd_event($VK_CONTROL, 0, 0, [IntPtr]::Zero)
  [PetWin32]::keybd_event($VK_MENU, 0, 0, [IntPtr]::Zero)
  [PetWin32]::keybd_event($VK_SHIFT, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [PetWin32]::keybd_event($VK, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [PetWin32]::keybd_event($VK, 0, $KEYUP, [IntPtr]::Zero)
  [PetWin32]::keybd_event($VK_SHIFT, 0, $KEYUP, [IntPtr]::Zero)
  [PetWin32]::keybd_event($VK_MENU, 0, $KEYUP, [IntPtr]::Zero)
  [PetWin32]::keybd_event($VK_CONTROL, 0, $KEYUP, [IntPtr]::Zero)
  Write-Output '{"ok":true}'
  exit 0
}

if ($Action -eq 'move') {
  [void][PetWin32]::SetCursorPos($X, $Y)
  Write-Output '{"ok":true}'
  exit 0
}

if ($Action -eq 'click' -or $Action -eq 'rclick') {
  # 真实鼠标点击（用于点系统托盘图标）：先移过去再按下抬起
  [void][PetWin32]::SetCursorPos($X, $Y)
  Start-Sleep -Milliseconds 120
  if ($Action -eq 'click') {
    [PetWin32]::mouse_event(0x02, 0, 0, 0, 0)   # LEFTDOWN
    Start-Sleep -Milliseconds 60
    [PetWin32]::mouse_event(0x04, 0, 0, 0, 0)   # LEFTUP
  } else {
    [PetWin32]::mouse_event(0x08, 0, 0, 0, 0)   # RIGHTDOWN
    Start-Sleep -Milliseconds 60
    [PetWin32]::mouse_event(0x10, 0, 0, 0, 0)   # RIGHTUP
  }
  Write-Output '{"ok":true}'
  exit 0
}

# 直接用主窗口句柄，避免 EnumWindows + 委托在旧版 PowerShell 里的解析问题
$best = $null
$bestArea = 0
$all = New-Object System.Collections.ArrayList

foreach ($proc in (Get-Process electron -ErrorAction SilentlyContinue)) {
  $handle = $proc.MainWindowHandle
  if ($handle -eq [IntPtr]::Zero) { continue }

  $rect = New-Object PetWin32+RECT
  if (-not [PetWin32]::GetWindowRect($handle, [ref]$rect)) { continue }

  $width = $rect.Right - $rect.Left
  $height = $rect.Bottom - $rect.Top
  if ($width -le 120 -or $height -le 60) { continue }

  $entry = [ordered]@{
    x       = $rect.Left
    y       = $rect.Top
    w       = $width
    h       = $height
    exStyle = ('0x{0:X}' -f [PetWin32]::GetWindowLongW($handle, -20))
    pid     = $proc.Id
  }
  [void]$all.Add($entry)

  $area = $width * $height
  if ($area -gt $bestArea) {
    $bestArea = $area
    $best = $entry
  }
}

if ($Action -eq 'list') {
  Write-Output (ConvertTo-Json -InputObject @($all) -Compress)
  exit 0
}

if ($null -eq $best) {
  Write-Output '{"error":"no pet window"}'
} else {
  Write-Output ($best | ConvertTo-Json -Compress)
}
