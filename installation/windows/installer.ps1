<#
  Installation de Registris sur Windows Server depuis l'archive décompressée (l'installateur graphique
  registris-x.y.z-installateur.exe fait la même chose avec un assistant).

  Copie l'application, écrit la configuration hors du dossier de l'application, crée le compte
  administrateur, installe le service Windows « Registris » et ouvre le port. Relancé sur une
  installation existante, met l'application à jour sans toucher aux données. Node.js est pris dans
  le dossier node\ de l'archive s'il est présent, sinon dans le PATH.

    installation\windows\installer.cmd                       (clic droit, puis répondre aux questions)
    .\installer.ps1 -Etablissement "CH de Ville" -Port 443    (en PowerShell, administrateur)

  Options : -Dossier, -Donnees, -Port, -Etablissement, -Admin,
            -Tls auto|pfx|pem|aucun, -Certificat, -Cle, -MotDePassePfx,
            -SansService (copie et configuration seulement), -SansParefeu, -Silencieux
#>
[CmdletBinding()]
param(
  [string]$Dossier = "$env:ProgramFiles\Registris",
  [string]$Donnees = "$env:ProgramData\Registris",
  [int]$Port = 3000,
  [string]$Etablissement = '',
  [string]$Admin = 'admin',
  [ValidateSet('auto', 'pfx', 'pem', 'aucun')][string]$Tls = 'auto',
  [string]$Certificat = '',
  [string]$Cle = '',
  [string]$MotDePassePfx = '',
  [switch]$SansService,
  [switch]$SansParefeu,
  [switch]$Silencieux
)

$ErrorActionPreference = 'Stop'
$env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
$Dossier = [IO.Path]::GetFullPath($Dossier)
$Donnees = [IO.Path]::GetFullPath($Donnees)
function Etape($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Echec($t) { Write-Host "ECHEC : $t" -ForegroundColor Red; exit 1 }
function EnClair($secure) {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function LireMotDePasse($invite) {
  while ($true) {
    $a = EnClair (Read-Host -AsSecureString $invite)
    $b = EnClair (Read-Host -AsSecureString 'Confirmez le mot de passe')
    if ($a -eq $b -and $a.Length -ge 12) { return $a }
    Write-Host 'Les deux saisies diffèrent ou font moins de 12 caractères.' -ForegroundColor Yellow
  }
}

$estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $estAdmin -and -not $SansService) {
  Echec "À lancer en tant qu'administrateur (clic droit sur installer.cmd), ou avec -SansService pour une installation sans service."
}

Etape 'Vérifications'
$Source = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if (-not (Test-Path (Join-Path $Source 'package.json'))) { Echec "package.json introuvable dans $Source : lancez ce script depuis l'archive décompressée." }
if (-not (Test-Path (Join-Path $Source 'node_modules'))) { Echec "node_modules absent : utilisez l'archive de release (dépendances incluses), pas le dépôt git." }
$Version = (Get-Content (Join-Path $Source 'package.json') -Raw | ConvertFrom-Json).version
$nodeExe = ''
if (Test-Path (Join-Path $Source 'node\node.exe')) {
  $nodeExe = Join-Path $Dossier 'node\node.exe'
  Write-Host "Node.js livré avec l'archive : $(& (Join-Path $Source 'node\node.exe') --version)"
} else {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) { Echec 'Node.js est absent et l''archive ne le contient pas : installez Node.js 22 LTS ou plus récent (https://nodejs.org), ou utilisez l''archive Windows de la release.' }
  $majeure = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
  if ($majeure -lt 22) { Echec "Node.js $majeure trouvé, version 22 minimum requise." }
  $nodeExe = $node.Source
  Write-Host "Node.js du système : $(& $node.Source --version)"
}
$exeService = Join-Path $PSScriptRoot 'registris-service.exe'
if (-not $SansService -and -not (Test-Path $exeService)) {
  Echec "registris-service.exe absent de $PSScriptRoot : il est fourni dans l'archive Windows de la release (WinSW 2.12.0)."
}
$service = Get-Service -Name Registris -ErrorAction SilentlyContinue
$config = Join-Path $Donnees 'registris.env'
$miseAJour = ($null -ne $service) -or (Test-Path $config)
if ($miseAJour) { Write-Host "Registris $Version : mise à jour d'une installation existante" } else { Write-Host "Registris $Version : nouvelle installation" }

$motDePasse = $null
if (-not $miseAJour -and -not $Silencieux) {
  Etape 'Paramètres'
  if (-not $Etablissement) { $Etablissement = Read-Host "Nom de l'établissement (affiché dans la barre haute)" }
  $saisiePort = Read-Host "Port d'écoute [$Port]"
  if ($saisiePort) { $Port = [int]$saisiePort }
  $saisieAdmin = Read-Host "Identifiant de l'administrateur [$Admin]"
  if ($saisieAdmin) { $Admin = $saisieAdmin }
  $motDePasse = LireMotDePasse "Mot de passe de $Admin (12 caractères minimum)"
} elseif (-not $miseAJour) {
  if (-not $env:REGISTRIS_MOT_DE_PASSE) { Echec 'En mode silencieux, le mot de passe administrateur est attendu dans REGISTRIS_MOT_DE_PASSE.' }
  $motDePasse = $env:REGISTRIS_MOT_DE_PASSE
}

Etape "Copie de l'application vers $Dossier"
if ($service -and $service.Status -eq 'Running') { Stop-Service -Name Registris; Write-Host 'Service arrêté.' }
New-Item -ItemType Directory -Force -Path $Dossier | Out-Null
& robocopy $Source $Dossier /MIR /NFL /NDL /NJH /NJS /NP /XD '.git' 'data' 'sauvegardes' | Out-Null
if ($LASTEXITCODE -ge 8) { Echec "copie impossible (robocopy $LASTEXITCODE)" }
Write-Host "Copié : $Dossier"

Etape 'Configuration'
$appel = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $Dossier 'installation\windows\configurer.ps1'),
  '-Dossier', $Dossier, '-Donnees', $Donnees, '-Node', $nodeExe, '-Port', $Port, '-Admin', $Admin, '-Tls', $Tls)
foreach ($p in @{ Etablissement = $Etablissement; Certificat = $Certificat; Cle = $Cle; MotDePassePfx = $MotDePassePfx }.GetEnumerator()) {
  if ($p.Value) { $appel += "-$($p.Key)", $p.Value }
}
$env:REGISTRIS_MOT_DE_PASSE = $motDePasse
try {
  & powershell @appel
  if ($LASTEXITCODE -ne 0) { Echec 'configuration' }
} finally {
  Remove-Item Env:REGISTRIS_MOT_DE_PASSE -ErrorAction SilentlyContinue
}
$lignesConfig = Get-Content $config
$hote = (($lignesConfig | Where-Object { $_ -like 'HOTE=*' } | Select-Object -First 1) -replace '^HOTE=', '')
$portConfig = (($lignesConfig | Where-Object { $_ -like 'PORT=*' } | Select-Object -First 1) -replace '^PORT=', '')
if ($portConfig) { $Port = [int]$portConfig }
$tlsActif = $lignesConfig | Where-Object { $_ -like 'TLS_PFX=*' -or $_ -like 'TLS_CERT=*' } | Select-Object -First 1
$schema = 'http'
if ($tlsActif) { $schema = 'https' }

if (-not $SansService) {
  Etape 'Service Windows « Registris »'
  $exe = Join-Path $Dossier 'service\registris-service.exe'
  if (-not $service) {
    & $exe install | Out-Null
    if ($LASTEXITCODE -ne 0) { Echec "installation du service (code $LASTEXITCODE)" }
    Write-Host 'Service installé (démarrage automatique, compte LocalService).'
  }
  if (-not $SansParefeu -and $hote -eq '0.0.0.0') {
    if (-not (Get-NetFirewallRule -DisplayName 'Registris' -ErrorAction SilentlyContinue)) {
      New-NetFirewallRule -DisplayName 'Registris' -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Domain, Private | Out-Null
      Write-Host "Règle de pare-feu ajoutée pour le port $Port."
    }
  }
  Start-Service -Name Registris
  Write-Host 'Service démarré.'

  Etape 'Vérification'
  $url = "${schema}://127.0.0.1:$Port/sante"
  $sonde = "require(process.argv[1]).get(process.argv[2],{rejectUnauthorized:false,timeout:3000},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{process.stdout.write(d);process.exit(r.statusCode===200?0:1)})}).on('error',()=>process.exit(1)).on('timeout',function(){this.destroy();process.exit(1)})"
  $ok = $false
  for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
    Start-Sleep -Seconds 1
    $reponse = & $nodeExe -e $sonde $schema $url
    if ($LASTEXITCODE -eq 0) { $ok = $true }
  }
  if (-not $ok) { Echec "le service ne répond pas sur $url ; consultez $Donnees\journaux\registris-service.err.log" }
  Write-Host "Réponse reçue : $reponse"
}

Etape 'Terminé'
$adresse = "${schema}://$([Net.Dns]::GetHostName()):$Port/"
if ($hote -eq '127.0.0.1') { $adresse = "${schema}://127.0.0.1:$Port/" }
Write-Host "Registris $Version : $adresse"
if (-not $miseAJour) { Write-Host "Compte administrateur : $Admin" }
Write-Host "Configuration : $config"
Write-Host "Données et sauvegardes : $Donnees"
if ($SansService) { Write-Host "Démarrage manuel : `$env:REGISTRIS_CONFIG='$config'; & `"$nodeExe`" `"$Dossier\src\cli.js`" servir" }
Write-Host 'Étapes suivantes : Active Directory et courriels dans la configuration, puis les tâches planifiées'
Write-Host "(sauvegarder, ancrer, verifier, relancer) décrites dans $Dossier\docs\DEPLOIEMENT.md."
