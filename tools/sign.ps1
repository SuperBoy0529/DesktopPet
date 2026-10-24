#  Sign the portable build.
#
#  IMPORTANT / 重要:
#    A self-signed certificate only makes the signature *internally valid* and,
#    if you install it into Trusted Root on THIS machine, Windows will show the
#    publisher name here. It does NOT make other machines trust it - that needs
#    a certificate from a public CA (OV/EV), which cannot be generated locally.
#
#  Usage:
#    powershell -ExecutionPolicy Bypass -File tools\sign.ps1                # 自签名(默认)
#    powershell -ExecutionPolicy Bypass -File tools\sign.ps1 -Trust          # 额外在本机信任
#    powershell -ExecutionPolicy Bypass -File tools\sign.ps1 -Pfx my.pfx -PfxPassword ***
#
#  ASCII-only + UTF-8 BOM.

param(
  [string] $Pfx = '',
  [string] $PfxPassword = '',
  [string] $Subject = 'CN=Worldline Divergence Meter, O=Local Build, C=CN',
  [switch] $Trust,
  [string] $Exe = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Exe) { $Exe = Join-Path $root 'dist\WorldlineDivergenceMeter\WorldlineDivergenceMeter.exe' }

if (-not (Test-Path $Exe)) {
  throw "Not found: $Exe  (run tools\build-portable.ps1 first)"
}

# ---------------------------------------------------------------- 取证书 ----
if ($Pfx) {
  if (-not (Test-Path $Pfx)) { throw "pfx not found: $Pfx" }
  $secure = ConvertTo-SecureString -String $PfxPassword -AsPlainText -Force
  $cert = Get-PfxCertificate -FilePath $Pfx
  if (-not $cert) { throw 'cannot read pfx' }
  Write-Host "[cert] using pfx: $Pfx"
} else {
  # 找现有的自签名证书，没有就建一个
  $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $Subject } |
    Sort-Object NotAfter -Descending |
    Select-Object -First 1

  if (-not $cert) {
    Write-Host "[cert] creating self-signed code signing certificate"
    $cert = New-SelfSignedCertificate `
      -Type CodeSigningCert `
      -Subject $Subject `
      -KeyUsage DigitalSignature `
      -KeyExportPolicy Exportable `
      -CertStoreLocation 'Cert:\CurrentUser\My' `
      -NotAfter (Get-Date).AddYears(3) `
      -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3')
  } else {
    Write-Host "[cert] reusing existing certificate"
  }
  Write-Host ("       subject    = {0}" -f $cert.Subject)
  Write-Host ("       thumbprint = {0}" -f $cert.Thumbprint)
  Write-Host ("       expires    = {0:yyyy-MM-dd}" -f $cert.NotAfter)
}

# ---------------------------------------------------------------- 签名 ------
Write-Host "[sign] $Exe"
$sig = Set-AuthenticodeSignature -FilePath $Exe -Certificate $cert `
  -TimestampServer 'http://timestamp.digicert.com' `
  -HashAlgorithm SHA256 `
  -ErrorAction Stop
Write-Host ("       status = {0}" -f $sig.Status)
if ($sig.StatusMessage) { Write-Host ("       msg    = {0}" -f $sig.StatusMessage) }

# --------------------------------------------------- 本机信任（可选）-------
if ($Trust) {
  Write-Host '[trust] installing certificate into CurrentUser Trusted Root'
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store 'Root', 'CurrentUser'
  $store.Open('ReadWrite')
  $store.Add($cert)
  $store.Close()
  Write-Host '        done (only affects THIS machine)'
}

# ---------------------------------------------------------------- 验证 ------
$check = Get-AuthenticodeSignature -FilePath $Exe
Write-Host ''
Write-Host '=== verification ==='
Write-Host ("Status      : {0}" -f $check.Status)
Write-Host ("StatusMsg   : {0}" -f $check.StatusMessage)
if ($check.SignerCertificate) {
  Write-Host ("Signer      : {0}" -f $check.SignerCertificate.Subject)
  Write-Host ("Thumbprint  : {0}" -f $check.SignerCertificate.Thumbprint)
}
if ($check.TimeStamperCertificate) {
  Write-Host ("Timestamped : {0}" -f $check.TimeStamperCertificate.Subject)
} else {
  Write-Host 'Timestamped : no (offline or server unreachable)'
}
