<#
  Installation de Registris sur Windows Server.

  Copie l'application, écrit la configuration hors du dossier de l'application, crée le compte
  administrateur, installe le service Windows « Registris » et ouvre le port. Relancé sur une
  installation existante, il met l'application à jour sans toucher aux données.

  À lancer depuis l'archive de release décompressée, en administrateur :
    installation\windows\installer.cmd                       (clic droit, puis répondre aux questions)
    .\installer.ps1 -Etablissement "CH de Ville" -Port 443    (en PowerShell)

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
$Dossier = [IO.Path]::GetFullPath($Dossier)
$Donnees = [IO.Path]::GetFullPath($Donnees)
function Etape($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Echec($t) { Write-Host "ECHEC : $t" -ForegroundColor Red; exit 1 }
function Hexa($n) {
  $octets = New-Object byte[] $n
  (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($octets)
  return ($octets | ForEach-Object { $_.ToString('x2') }) -join ''
}
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
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Echec 'Node.js est absent. Installez Node.js 22 LTS ou plus récent (installeur MSI sur https://nodejs.org), puis relancez.' }
$nodeExe = $node.Source
$majeure = [int]((& $nodeExe --version).TrimStart('v').Split('.')[0])
if ($majeure -lt 22) { Echec "Node.js $majeure trouvé, version 22 minimum requise." }
$exeService = Join-Path $PSScriptRoot 'registris-service.exe'
if (-not $SansService -and -not (Test-Path $exeService)) {
  Echec "registris-service.exe absent de $PSScriptRoot : il est fourni dans l'archive de release (WinSW 2.12.0)."
}
$service = Get-Service -Name Registris -ErrorAction SilentlyContinue
$config = Join-Path $Donnees 'registris.env'
$miseAJour = ($null -ne $service) -or (Test-Path $config)
Write-Host "Registris $Version, Node.js $(& $nodeExe --version), $(if ($miseAJour) { 'mise à jour d''une installation existante' } else { 'nouvelle installation' })"

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

Etape "Dossiers de données : $Donnees"
foreach ($d in '', 'preuves', 'logos', 'ancrages', 'sauvegardes', 'journaux', 'tls') {
  New-Item -ItemType Directory -Force -Path (Join-Path $Donnees $d) | Out-Null
}
# LocalService (S-1-5-19) fait tourner le service : lecture et écriture sur les données.
& icacls $Donnees /grant '*S-1-5-19:(OI)(CI)M' /T /Q | Out-Null

if (-not $miseAJour) {
  Etape 'Certificat et configuration'
  $hote = '0.0.0.0'
  $tlsLignes = @()
  $dossierTls = Join-Path $Donnees 'tls'
  switch ($Tls) {
    'aucun' {
      $hote = '127.0.0.1'
      $tlsLignes = @('# Sans TLS : écoute locale seulement, à exposer par un reverse-proxy HTTPS (IIS avec ARR, nginx).')
      Write-Host 'Sans TLS : l''application n''écoutera que sur 127.0.0.1.'
    }
    'pfx' {
      if (-not (Test-Path $Certificat)) { Echec "certificat PFX introuvable : $Certificat" }
      Copy-Item $Certificat (Join-Path $dossierTls 'registris.pfx') -Force
      $tlsLignes = @("TLS_PFX=$dossierTls\registris.pfx", "TLS_PFX_MOT_DE_PASSE=$MotDePassePfx")
      Write-Host "Certificat PFX copié dans $dossierTls."
    }
    'pem' {
      if (-not (Test-Path $Certificat) -or -not (Test-Path $Cle)) { Echec 'certificat ou clé PEM introuvable (-Certificat, -Cle)' }
      Copy-Item $Certificat (Join-Path $dossierTls 'registris.crt') -Force
      Copy-Item $Cle (Join-Path $dossierTls 'registris.key') -Force
      $tlsLignes = @("TLS_CERT=$dossierTls\registris.crt", "TLS_KEY=$dossierTls\registris.key")
      Write-Host "Certificat et clé copiés dans $dossierTls."
    }
    'auto' {
      $nomHote = [Net.Dns]::GetHostName()
      $noms = @($nomHote, 'localhost')
      try { $fqdn = [Net.Dns]::GetHostEntry($nomHote).HostName; if ($fqdn -and $fqdn -ne $nomHote) { $noms += $fqdn } } catch {}
      $magasin = if ($estAdmin) { 'Cert:\LocalMachine\My' } else { 'Cert:\CurrentUser\My' }
      $cert = New-SelfSignedCertificate -DnsName $noms -CertStoreLocation $magasin -FriendlyName "Registris ($nomHote)" -NotAfter (Get-Date).AddYears(3) -KeyExportPolicy Exportable
      $mdpPfx = Hexa 16
      $pfx = Join-Path $dossierTls 'registris.pfx'
      Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString $mdpPfx -AsPlainText -Force) -CryptoAlgorithmOption AES256_SHA256 | Out-Null
      Remove-Item $cert.PSPath
      $tlsLignes = @(
        "# Certificat auto-signé généré à l'installation pour $($noms -join ', ') : le navigateur avertira.",
        '# Remplacez-le par un certificat de votre PKI (TLS_PFX exporté en AES256_SHA256, ou TLS_CERT et TLS_KEY).',
        "TLS_PFX=$pfx",
        "TLS_PFX_MOT_DE_PASSE=$mdpPfx"
      )
      Write-Host "Certificat auto-signé créé pour $($noms -join ', ')."
    }
  }
  # Lisible par les administrateurs, le service (LocalService) et le compte qui installe, personne d'autre.
  $sidCourant = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  & icacls $dossierTls /inheritance:r /grant '*S-1-5-32-544:(OI)(CI)F' /grant '*S-1-5-19:(OI)(CI)R' /grant "*${sidCourant}:(OI)(CI)F" /Q | Out-Null

  $lignes = @(
    "# Configuration de Registris, lue par le service (variable REGISTRIS_CONFIG). Modèle complet : $Dossier\.env.example",
    "NOM_ETABLISSEMENT=$Etablissement",
    'NODE_ENV=production',
    "HOTE=$hote",
    "PORT=$Port",
    "SESSION_SECRET=$(Hexa 48)",
    "DB_PATH=$Donnees\registris.db",
    "PREUVES_DIR=$Donnees\preuves",
    "LOGOS_DIR=$Donnees\logos",
    "ANCRAGES_DIR=$Donnees\ancrages",
    "SAUVEGARDES_DIR=$Donnees\sauvegardes"
  ) + $tlsLignes + @(
    'AUTH_MODE=local',
    '# Active Directory : AUTH_MODE=ldap puis les lignes LDAP_* du modèle .env.example.',
    '# Courriels : SMTP_HOST=smtp.etablissement.local et SMTP_FROM=registris@etablissement.fr.'
  )
  [IO.File]::WriteAllLines($config, $lignes, (New-Object Text.UTF8Encoding $false))
  & icacls $config /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-19:R' /grant "*${sidCourant}:F" /Q | Out-Null
  Write-Host "Configuration écrite : $config"

  Etape "Compte administrateur « $Admin »"
  $env:REGISTRIS_CONFIG = $config
  $env:REGISTRIS_MOT_DE_PASSE = $motDePasse
  try {
    & $nodeExe (Join-Path $Dossier 'src\cli.js') utilisateur $Admin admin 'Administrateur'
    if ($LASTEXITCODE -ne 0) { Echec 'création du compte administrateur' }
  } finally {
    Remove-Item Env:REGISTRIS_MOT_DE_PASSE -ErrorAction SilentlyContinue
  }
} else {
  $hote = ((Get-Content $config) | Where-Object { $_ -like 'HOTE=*' } | Select-Object -First 1) -replace '^HOTE=', ''
  $saisiePort = ((Get-Content $config) | Where-Object { $_ -like 'PORT=*' } | Select-Object -First 1) -replace '^PORT=', ''
  if ($saisiePort) { $Port = [int]$saisiePort }
  Write-Host "Configuration conservée : $config"
}
$tlsActif = (Get-Content $config) | Where-Object { $_ -like 'TLS_PFX=*' -or $_ -like 'TLS_CERT=*' } | Select-Object -First 1

if (-not $SansService) {
  Etape 'Service Windows « Registris »'
  $svc = Join-Path $Dossier 'service'
  New-Item -ItemType Directory -Force -Path $svc | Out-Null
  $exe = Join-Path $svc 'registris-service.exe'
  Copy-Item $exeService $exe -Force
  $xml = (Get-Content (Join-Path $PSScriptRoot 'registris-service.xml') -Raw)
  $xml = $xml.Replace('{{NODE}}', $nodeExe).Replace('{{DOSSIER}}', $Dossier).Replace('{{CONFIG}}', $config).Replace('{{JOURNAUX}}', (Join-Path $Donnees 'journaux'))
  [IO.File]::WriteAllText((Join-Path $svc 'registris-service.xml'), $xml, (New-Object Text.UTF8Encoding $false))
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
  $schema = if ($tlsActif) { 'https' } else { 'http' }
  $url = "${schema}://127.0.0.1:$Port/sante"
  [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  $ok = $false
  for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
    Start-Sleep -Seconds 1
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 3; if ($r.StatusCode -eq 200) { $ok = $true } } catch {}
  }
  if (-not $ok) { Echec "le service ne répond pas sur $url ; consultez $Donnees\journaux\registris-service.err.log" }
  Write-Host "Réponse reçue : $($r.Content)"
}

Etape 'Terminé'
$schema = if ($tlsActif) { 'https' } else { 'http' }
$adresse = if ($hote -eq '127.0.0.1') { "${schema}://127.0.0.1:$Port/" } else { "${schema}://$([Net.Dns]::GetHostName()):$Port/" }
Write-Host "Registris $Version : $adresse"
if (-not $miseAJour) { Write-Host "Compte administrateur : $Admin" }
Write-Host "Configuration : $config"
Write-Host "Données et sauvegardes : $Donnees"
if ($SansService) { Write-Host "Démarrage manuel : `$env:REGISTRIS_CONFIG='$config'; node `"$Dossier\src\cli.js`" servir" }
Write-Host 'Étapes suivantes : Active Directory et courriels dans la configuration, puis les tâches planifiées'
Write-Host "(sauvegarder, ancrer, verifier, relancer) décrites dans $Dossier\docs\DEPLOIEMENT.md."
