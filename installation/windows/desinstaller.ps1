<#
  Désinstallation de Registris sur Windows : arrête et retire le service, la règle de pare-feu et le
  dossier de l'application. Les données (base, pièces, configuration, sauvegardes) sont conservées,
  sauf avec -SupprimerDonnees.
    .\desinstaller.ps1 [-Dossier ...] [-Donnees ...] [-SupprimerDonnees]
#>
[CmdletBinding()]
param(
  [string]$Dossier = "$env:ProgramFiles\Registris",
  [string]$Donnees = "$env:ProgramData\Registris",
  [switch]$SupprimerDonnees
)
$ErrorActionPreference = 'Continue'
$exe = Join-Path $Dossier 'service\registris-service.exe'
if (Get-Service -Name Registris -ErrorAction SilentlyContinue) {
  if (Test-Path $exe) { & $exe stop | Out-Null; & $exe uninstall | Out-Null; Write-Host 'Service retiré.' }
  else { & sc.exe stop Registris | Out-Null; & sc.exe delete Registris | Out-Null; Write-Host 'Service retiré (sc.exe).' }
}
if (Get-NetFirewallRule -DisplayName 'Registris' -ErrorAction SilentlyContinue) {
  Remove-NetFirewallRule -DisplayName 'Registris'
  Write-Host 'Règle de pare-feu retirée.'
}
if (Test-Path $Dossier) { Remove-Item -Recurse -Force $Dossier; Write-Host "Application supprimée : $Dossier" }
if ($SupprimerDonnees) {
  if (Test-Path $Donnees) { Remove-Item -Recurse -Force $Donnees; Write-Host "Données supprimées : $Donnees" }
} else {
  Write-Host "Données conservées : $Donnees (base, pièces, configuration, sauvegardes)."
}
