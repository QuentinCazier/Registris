<#
  Configuration initiale de Registris sur Windows, sans interaction. Appelé par installer.ps1 et par
  l'installateur graphique. Écrit la configuration hors du dossier de l'application, le certificat, le
  compte administrateur et le descripteur du service. Relancé sur une installation existante, ne
  réécrit que le descripteur du service.

  Le mot de passe administrateur vient de REGISTRIS_MOT_DE_PASSE, ou du fichier de réponses JSON
  (-Reponses), supprimé après lecture.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier,
  [Parameter(Mandatory = $true)][string]$Donnees,
  [string]$Node = '',
  [int]$Port = 3000,
  [string]$Etablissement = '',
  [string]$Admin = 'admin',
  [ValidateSet('auto', 'pfx', 'pem', 'aucun')][string]$Tls = 'auto',
  [string]$Certificat = '',
  [string]$Cle = '',
  [string]$MotDePassePfx = '',
  [string]$Reponses = '',
  [string]$Journal = ''
)

$ErrorActionPreference = 'Stop'
if ($Journal) { Start-Transcript -Path $Journal -Force | Out-Null }

function Hexa($n) {
  $octets = New-Object byte[] $n
  (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($octets)
  return ($octets | ForEach-Object { $_.ToString('x2') }) -join ''
}

try {
  $Dossier = [IO.Path]::GetFullPath($Dossier)
  $Donnees = [IO.Path]::GetFullPath($Donnees)
  $motDePasse = $env:REGISTRIS_MOT_DE_PASSE

  if ($Reponses) {
    $r = Get-Content -LiteralPath $Reponses -Raw -Encoding UTF8 | ConvertFrom-Json
    Remove-Item -LiteralPath $Reponses -Force
    if ($r.etablissement) { $Etablissement = [string]$r.etablissement }
    if ($r.port) { $Port = [int]$r.port }
    if ($r.admin) { $Admin = [string]$r.admin }
    if ($r.motDePasse) { $motDePasse = [string]$r.motDePasse }
    if ($r.tls) { $Tls = [string]$r.tls }
    if ($r.certificat) { $Certificat = [string]$r.certificat }
    if ($r.motDePassePfx) { $MotDePassePfx = [string]$r.motDePassePfx }
  }

  # Node.js : chemin fourni, sinon node\node.exe livré avec l'application, sinon celui du PATH.
  if (-not $Node) {
    if (Test-Path (Join-Path $Dossier 'node\node.exe')) { $Node = Join-Path $Dossier 'node\node.exe' }
    else {
      $c = Get-Command node -ErrorAction SilentlyContinue
      if ($c) { $Node = $c.Source }
    }
  }
  if (-not $Node -or -not (Test-Path $Node)) { throw 'Node.js introuvable : ni node\node.exe dans le dossier de l''application, ni node dans le PATH.' }

  $estAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  $sidCourant = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $config = Join-Path $Donnees 'registris.env'
  $miseAJour = Test-Path $config

  foreach ($d in '', 'preuves', 'logos', 'ancrages', 'sauvegardes', 'journaux', 'tls') {
    New-Item -ItemType Directory -Force -Path (Join-Path $Donnees $d) | Out-Null
  }
  # Le service tourne sous LocalService (S-1-5-19) : lecture et écriture sur les données.
  & icacls $Donnees /grant '*S-1-5-19:(OI)(CI)M' /Q | Out-Null

  if (-not $miseAJour) {
    if (-not $Etablissement) { throw 'Le nom de l''établissement est requis.' }
    if (-not $motDePasse -or $motDePasse.Length -lt 12) { throw 'Mot de passe administrateur absent ou trop court (12 caractères minimum).' }
    $hote = '0.0.0.0'
    $tlsLignes = @()
    $dossierTls = Join-Path $Donnees 'tls'
    switch ($Tls) {
      'aucun' {
        $hote = '127.0.0.1'
        $tlsLignes = @('# Sans TLS : écoute locale seulement, à exposer par un reverse-proxy HTTPS (IIS avec ARR, nginx).')
        Write-Host 'Sans TLS : écoute sur 127.0.0.1 seulement.'
      }
      'pfx' {
        if (-not (Test-Path $Certificat)) { throw "certificat PFX introuvable : $Certificat" }
        Copy-Item $Certificat (Join-Path $dossierTls 'registris.pfx') -Force
        $tlsLignes = @("TLS_PFX=$dossierTls\registris.pfx", "TLS_PFX_MOT_DE_PASSE=$MotDePassePfx")
        Write-Host "Certificat PFX copié dans $dossierTls."
      }
      'pem' {
        if (-not (Test-Path $Certificat) -or -not (Test-Path $Cle)) { throw 'certificat ou clé PEM introuvable (-Certificat, -Cle)' }
        Copy-Item $Certificat (Join-Path $dossierTls 'registris.crt') -Force
        Copy-Item $Cle (Join-Path $dossierTls 'registris.key') -Force
        $tlsLignes = @("TLS_CERT=$dossierTls\registris.crt", "TLS_KEY=$dossierTls\registris.key")
        Write-Host "Certificat et clé copiés dans $dossierTls."
      }
      'auto' {
        $nomHote = [Net.Dns]::GetHostName()
        $noms = @($nomHote, 'localhost')
        try { $fqdn = [Net.Dns]::GetHostEntry($nomHote).HostName; if ($fqdn -and $fqdn -ne $nomHote) { $noms += $fqdn } } catch {}
        if (-not (Get-Command Export-PfxCertificate).Parameters.ContainsKey('CryptoAlgorithmOption')) {
          throw 'Le certificat auto-signé demande Windows Server 2022 ou plus récent (export AES256). Fournissez un certificat PFX (-Tls pfx) ou choisissez -Tls aucun derrière un reverse-proxy.'
        }
        $magasin = 'Cert:\CurrentUser\My'
        if ($estAdmin) { $magasin = 'Cert:\LocalMachine\My' }
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
    # Lisible par les administrateurs, le service et le compte qui installe, personne d'autre.
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

    $env:REGISTRIS_CONFIG = $config
    $env:REGISTRIS_MOT_DE_PASSE = $motDePasse
    try {
      & $Node (Join-Path $Dossier 'src\cli.js') utilisateur $Admin admin 'Administrateur'
      if ($LASTEXITCODE -ne 0) { throw 'création du compte administrateur' }
    } finally {
      Remove-Item Env:REGISTRIS_MOT_DE_PASSE -ErrorAction SilentlyContinue
    }
  } else {
    Write-Host "Configuration conservée : $config"
  }

  # Descripteur du service Windows (WinSW), regénéré à chaque passage : chemin de node.exe et dossiers.
  $svc = Join-Path $Dossier 'service'
  New-Item -ItemType Directory -Force -Path $svc | Out-Null
  $exeSource = Join-Path $Dossier 'installation\windows\registris-service.exe'
  if (Test-Path $exeSource) { Copy-Item $exeSource (Join-Path $svc 'registris-service.exe') -Force }
  $xml = Get-Content (Join-Path $Dossier 'installation\windows\registris-service.xml') -Raw
  $xml = $xml.Replace('{{NODE}}', $Node).Replace('{{DOSSIER}}', $Dossier).Replace('{{CONFIG}}', $config).Replace('{{JOURNAUX}}', (Join-Path $Donnees 'journaux'))
  [IO.File]::WriteAllText((Join-Path $svc 'registris-service.xml'), $xml, (New-Object Text.UTF8Encoding $false))
  Write-Host "Descripteur du service écrit : $svc\registris-service.xml (node : $Node)"
  if ($Journal) { Stop-Transcript | Out-Null }
  exit 0
} catch {
  Write-Host "ECHEC : $($_.Exception.Message)" -ForegroundColor Red
  if ($Journal) { Stop-Transcript | Out-Null }
  exit 1
}
