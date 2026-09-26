<#
  Configuration de Registris sur Windows, sans interaction. Appelé par installer.ps1 et par
  l'installateur graphique.

  Première installation : écrit la configuration hors du dossier de l'application, le certificat et
  le compte administrateur. Sur une installation existante : conserve la configuration, ou la modifie
  si le fichier de réponses le demande (mode « modifier »). Dans tous les cas, régénère le descripteur
  du service et contrôle la configuration (annuaire, messagerie, certificat).

  Réponses (-Reponses, fichier JSON supprimé après lecture) :
    mode           installer | modifier | conserver
    importer       fichier registris.env ou .env à reprendre
    etablissement, port, admin, motDePasse, tls (auto|pfx|pem|aucun|conserver), certificat, cle, motDePassePfx
    caAnnuaire     certificat de l'autorité de l'annuaire, copié à côté des données
    parametres     toute clé de configuration : { "SMTP_HOST": "smtp.local", ... }
  Le mot de passe administrateur peut aussi venir de REGISTRIS_MOT_DE_PASSE.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dossier,
  [Parameter(Mandatory = $true)][string]$Donnees,
  [string]$Node = '',
  [int]$Port = 0,
  [string]$Etablissement = '',
  [string]$Admin = 'admin',
  [ValidateSet('auto', 'pfx', 'pem', 'aucun', 'conserver', '')][string]$Tls = '',
  [string]$Certificat = '',
  [string]$Cle = '',
  [string]$MotDePassePfx = '',
  [string]$Importer = '',
  [string]$Reponses = '',
  [string]$Journal = ''
)

$ErrorActionPreference = 'Stop'
# Lancé depuis PowerShell 7, Windows PowerShell hérite de ses modules et perd le lecteur Cert:.
$env:PSModulePath = [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
if ($Journal) { Start-Transcript -Path $Journal -Force | Out-Null }

function Hexa($n) {
  $octets = New-Object byte[] $n
  (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($octets)
  return ($octets | ForEach-Object { $_.ToString('x2') }) -join ''
}

# Même lecture que l'application : pas de commentaire en fin de ligne, guillemets extérieurs retirés.
function LireEnv($chemin) {
  $m = [ordered]@{}
  if (-not $chemin -or -not (Test-Path -LiteralPath $chemin)) { return $m }
  foreach ($ligne in [IO.File]::ReadAllLines($chemin)) {
    $t = $ligne.Trim().TrimStart([char]0xFEFF)
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $v = $t.Substring($i + 1).Trim()
    if ($v.Length -ge 2 -and ($v[0] -eq '"' -or $v[0] -eq "'") -and $v[-1] -eq $v[0]) { $v = $v.Substring(1, $v.Length - 2) }
    $m[$t.Substring(0, $i).Trim()] = $v
  }
  return $m
}

function Valeur($v) {
  $s = [string]$v
  if ($s.Trim() -ne $s -or ($s.Length -ge 2 -and ($s[0] -eq '"' -or $s[0] -eq "'") -and $s[-1] -eq $s[0])) {
    if ($s.Contains('"')) { return "'$s'" }
    return "`"$s`""
  }
  return $s
}

# Ordre et commentaires du fichier écrit ; les clés inconnues suivent, telles quelles.
$SECTIONS = [ordered]@{
  'Établissement'                     = @('NOM_ETABLISSEMENT', 'COULEUR_ACCENT', 'APP_URL')
  'Réseau et HTTPS'                   = @('HOTE', 'PORT', 'TLS_PFX', 'TLS_PFX_MOT_DE_PASSE', 'TLS_CERT', 'TLS_KEY', 'SECURE_COOKIE', 'TRUST_PROXY')
  'Authentification'                  = @('AUTH_MODE', 'LDAP_URL', 'LDAP_BASE_DN', 'LDAP_SEARCH_BASE', 'LDAP_LOGIN_ATTR', 'LDAP_BIND_DN', 'LDAP_BIND_PASSWORD', 'LDAP_USER_DN', 'LDAP_CA_CERT', 'LDAP_TIMEOUT_MS', 'LDAP_GROUPES_IMBRIQUES', 'LDAP_GROUPE_ADMIN', 'LDAP_GROUPE_REFERENT', 'LDAP_GROUPE_CONTROLEUR', 'LDAP_GROUPE_UTILISATEUR')
  'Courriels'                         = @('SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'ANCRAGE_EMAIL')
  'Fonctionnement et conservation'    = @('RELANCE_JOURS', 'ENTRETIEN_AUTO', 'CONSERVATION_ANNEES', 'TAILLE_MAX_PREUVE')
  'Données, gérées par l''installateur' = @('NODE_ENV', 'SESSION_SECRET', 'DB_PATH', 'PREUVES_DIR', 'LOGOS_DIR', 'ANCRAGES_DIR', 'SAUVEGARDES_DIR')
}

function EcrireEnv($chemin, $m) {
  $lignes = New-Object Collections.Generic.List[string]
  $lignes.Add("# Configuration de Registris, lue par le service au démarrage (variable REGISTRIS_CONFIG).")
  $lignes.Add("# Pour la modifier : relancer l'installateur et choisir « Modifier la configuration ». Modèle commenté : $Dossier\.env.example")
  $vues = @{}
  foreach ($titre in $SECTIONS.Keys) {
    $cles = @($SECTIONS[$titre] | Where-Object { $m.Contains($_) -and "$($m[$_])" -ne '' })
    if (-not $cles.Count) { continue }
    $lignes.Add(''); $lignes.Add("# --- $titre")
    foreach ($c in $cles) { $lignes.Add("$c=$(Valeur $m[$c])"); $vues[$c] = $true }
  }
  $autres = @($m.Keys | Where-Object { -not $vues[$_] -and "$($m[$_])" -ne '' })
  if ($autres.Count) {
    $lignes.Add(''); $lignes.Add('# --- Autres réglages')
    foreach ($c in $autres) { $lignes.Add("$c=$(Valeur $m[$c])") }
  }
  [IO.File]::WriteAllLines($chemin, $lignes, (New-Object Text.UTF8Encoding $false))
}

try {
  $Dossier = [IO.Path]::GetFullPath($Dossier)
  $Donnees = [IO.Path]::GetFullPath($Donnees)
  $motDePasse = $env:REGISTRIS_MOT_DE_PASSE
  $mode = ''
  $caAnnuaire = ''
  $parametres = @{}

  if ($Reponses) {
    $r = Get-Content -LiteralPath $Reponses -Raw -Encoding UTF8 | ConvertFrom-Json
    Remove-Item -LiteralPath $Reponses -Force
    if ($r.mode) { $mode = [string]$r.mode }
    if ($r.importer) { $Importer = [string]$r.importer }
    if ($r.etablissement) { $Etablissement = [string]$r.etablissement }
    if ($r.port) { $Port = [int]$r.port }
    if ($r.admin) { $Admin = [string]$r.admin }
    if ($r.motDePasse) { $motDePasse = [string]$r.motDePasse }
    if ($r.tls) { $Tls = [string]$r.tls }
    if ($r.certificat) { $Certificat = [string]$r.certificat }
    if ($r.cle) { $Cle = [string]$r.cle }
    if ($r.motDePassePfx) { $MotDePassePfx = [string]$r.motDePassePfx }
    if ($r.caAnnuaire) { $caAnnuaire = [string]$r.caAnnuaire }
    if ($r.parametres) { foreach ($p in $r.parametres.PSObject.Properties) { $parametres[$p.Name] = [string]$p.Value } }
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
  $existe = Test-Path $config
  if (-not $mode) { $mode = if ($existe) { if ($Importer) { 'modifier' } else { 'conserver' } } else { 'installer' } }
  if (-not $existe) { $mode = 'installer' }
  if ($Importer -and -not (Test-Path -LiteralPath $Importer)) { throw "Fichier de configuration à reprendre introuvable : $Importer" }

  foreach ($d in '', 'preuves', 'logos', 'ancrages', 'sauvegardes', 'journaux', 'tls') {
    New-Item -ItemType Directory -Force -Path (Join-Path $Donnees $d) | Out-Null
  }
  # Le service tourne sous LocalService (S-1-5-19) : lecture et écriture sur les données.
  & icacls $Donnees /grant '*S-1-5-19:(OI)(CI)M' /Q | Out-Null
  $dossierTls = Join-Path $Donnees 'tls'

  if ($mode -eq 'conserver') {
    Write-Host "Configuration conservée : $config"
  } else {
    $m = if ($mode -eq 'modifier') { LireEnv $config } else { [ordered]@{} }
    $repris = LireEnv $Importer
    foreach ($k in $repris.Keys) {
      # Une configuration reprise ne déplace ni les données ni le secret d'une installation en place.
      if ($mode -eq 'modifier' -and $k -in @('SESSION_SECRET', 'DB_PATH', 'PREUVES_DIR', 'LOGOS_DIR', 'ANCRAGES_DIR', 'SAUVEGARDES_DIR')) { continue }
      $m[$k] = $repris[$k]
    }
    if ($repris.Count) { Write-Host "Configuration reprise de $Importer ($($repris.Count) réglages)." }

    if ($Etablissement) { $m['NOM_ETABLISSEMENT'] = $Etablissement }
    if ($Port -gt 0) { $m['PORT'] = "$Port" }
    if (-not $m['PORT']) { $m['PORT'] = '3000' }
    $m['NODE_ENV'] = 'production'
    if (-not $m['SESSION_SECRET']) { $m['SESSION_SECRET'] = Hexa 48 }
    if ($mode -eq 'installer') {
      $m['DB_PATH'] = "$Donnees\registris.db"; $m['PREUVES_DIR'] = "$Donnees\preuves"; $m['LOGOS_DIR'] = "$Donnees\logos"
      $m['ANCRAGES_DIR'] = "$Donnees\ancrages"; $m['SAUVEGARDES_DIR'] = "$Donnees\sauvegardes"
    }

    # HTTPS : le certificat repris ou en place n'est gardé que s'il existe sur ce serveur.
    if (-not $Tls) { $Tls = if ($m['TLS_PFX'] -or $m['TLS_CERT']) { 'conserver' } else { 'auto' } }
    if ($Tls -eq 'conserver') {
      foreach ($k in 'TLS_PFX', 'TLS_CERT', 'TLS_KEY') {
        if ($m[$k] -and -not (Test-Path -LiteralPath $m[$k])) { throw "Certificat à conserver introuvable sur ce serveur : $($m[$k]). Choisissez un autre mode HTTPS." }
      }
      if (-not ($m['TLS_PFX'] -or $m['TLS_CERT'])) { $m['HOTE'] = '127.0.0.1' }
      elseif (-not $m['HOTE'] -or $m['HOTE'] -eq '127.0.0.1') { $m['HOTE'] = '0.0.0.0' }
      Write-Host 'HTTPS : réglage conservé.'
    } else {
      foreach ($k in 'TLS_PFX', 'TLS_PFX_MOT_DE_PASSE', 'TLS_CERT', 'TLS_KEY', 'SECURE_COOKIE', 'TRUST_PROXY') { $m.Remove($k) }
      $m['HOTE'] = '0.0.0.0'
      switch ($Tls) {
        'aucun' {
          # Le reverse-proxy chiffre : le cookie reste réservé au HTTPS, l'adresse d'origine vient du proxy.
          $m['HOTE'] = '127.0.0.1'; $m['SECURE_COOKIE'] = 'true'; $m['TRUST_PROXY'] = 'true'
          Write-Host 'Sans HTTPS : écoute sur 127.0.0.1 seulement, derrière un reverse-proxy.'
        }
        'pfx' {
          if (-not (Test-Path -LiteralPath $Certificat)) { throw "certificat PFX introuvable : $Certificat" }
          Copy-Item -LiteralPath $Certificat (Join-Path $dossierTls 'registris.pfx') -Force
          $m['TLS_PFX'] = "$dossierTls\registris.pfx"; $m['TLS_PFX_MOT_DE_PASSE'] = $MotDePassePfx
          Write-Host "Certificat PFX copié dans $dossierTls."
        }
        'pem' {
          if (-not (Test-Path -LiteralPath $Certificat) -or -not (Test-Path -LiteralPath $Cle)) { throw 'certificat ou clé PEM introuvable' }
          Copy-Item -LiteralPath $Certificat (Join-Path $dossierTls 'registris.crt') -Force
          Copy-Item -LiteralPath $Cle (Join-Path $dossierTls 'registris.key') -Force
          $m['TLS_CERT'] = "$dossierTls\registris.crt"; $m['TLS_KEY'] = "$dossierTls\registris.key"
          Write-Host "Certificat et clé copiés dans $dossierTls."
        }
        'auto' {
          if (-not (Get-Command Export-PfxCertificate).Parameters.ContainsKey('CryptoAlgorithmOption')) {
            throw 'Le certificat auto-signé demande Windows Server 2022 ou plus récent (export AES256). Fournissez un certificat PFX ou choisissez le mode sans HTTPS.'
          }
          $nomHote = [Net.Dns]::GetHostName()
          $noms = @($nomHote, 'localhost')
          try { $fqdn = [Net.Dns]::GetHostEntry($nomHote).HostName; if ($fqdn -and $fqdn -ne $nomHote) { $noms += $fqdn } } catch {}
          $magasin = 'Cert:\CurrentUser\My'
          if ($estAdmin) { $magasin = 'Cert:\LocalMachine\My' }
          $cert = New-SelfSignedCertificate -DnsName $noms -CertStoreLocation $magasin -FriendlyName "Registris ($nomHote)" -NotAfter (Get-Date).AddYears(3) -KeyExportPolicy Exportable
          $mdpPfx = Hexa 16
          $pfx = Join-Path $dossierTls 'registris.pfx'
          Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString $mdpPfx -AsPlainText -Force) -CryptoAlgorithmOption AES256_SHA256 | Out-Null
          Remove-Item $cert.PSPath
          $m['TLS_PFX'] = $pfx; $m['TLS_PFX_MOT_DE_PASSE'] = $mdpPfx
          Write-Host "Certificat auto-signé créé pour $($noms -join ', ')."
        }
      }
    }

    if ($caAnnuaire) {
      if (-not (Test-Path -LiteralPath $caAnnuaire)) { throw "Certificat de l'autorité de l'annuaire introuvable : $caAnnuaire" }
      Copy-Item -LiteralPath $caAnnuaire (Join-Path $dossierTls 'ca-annuaire.pem') -Force
      $m['LDAP_CA_CERT'] = "$dossierTls\ca-annuaire.pem"
    }
    foreach ($k in $parametres.Keys) {
      if ($k -notmatch '^[A-Z][A-Z0-9_]*$') { throw "Clé de configuration invalide : $k" }
      $m[$k] = $parametres[$k]
    }
    if (-not $m['NOM_ETABLISSEMENT']) { throw 'Le nom de l''établissement est requis.' }
    if ($m['AUTH_MODE'] -eq 'ldap' -and $m['LDAP_BASE_DN'] -and -not $m['LDAP_SEARCH_BASE']) { $m['LDAP_SEARCH_BASE'] = $m['LDAP_BASE_DN'] }
    if (-not $m['AUTH_MODE']) { $m['AUTH_MODE'] = 'local' }
    if (-not $m['APP_URL'] -and $m['HOTE'] -ne '127.0.0.1') {
      $schema = if ($m['TLS_PFX'] -or $m['TLS_CERT']) { 'https' } else { 'http' }
      $m['APP_URL'] = "${schema}://$([Net.Dns]::GetHostName()):$($m['PORT'])"
    }

    # Lisible par les administrateurs, le service et le compte qui installe, personne d'autre.
    & icacls $dossierTls /inheritance:r /grant '*S-1-5-32-544:(OI)(CI)F' /grant '*S-1-5-19:(OI)(CI)R' /grant "*${sidCourant}:(OI)(CI)F" /Q | Out-Null
    EcrireEnv $config $m
    & icacls $config /inheritance:r /grant '*S-1-5-32-544:F' /grant '*S-1-5-19:R' /grant "*${sidCourant}:F" /Q | Out-Null
    Write-Host "Configuration $(if ($mode -eq 'modifier') { 'modifiée' } else { 'écrite' }) : $config"
  }

  $env:REGISTRIS_CONFIG = $config
  if (-not $existe) {
    if (-not $motDePasse -or $motDePasse.Length -lt 12) { throw 'Mot de passe administrateur absent ou trop court (12 caractères minimum).' }
    $env:REGISTRIS_MOT_DE_PASSE = $motDePasse
    try {
      & $Node (Join-Path $Dossier 'src\cli.js') utilisateur $Admin admin 'Administrateur'
      if ($LASTEXITCODE -ne 0) { throw 'création du compte administrateur' }
    } finally {
      Remove-Item Env:REGISTRIS_MOT_DE_PASSE -ErrorAction SilentlyContinue
    }
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

  # Contrôle de ce qui vient d'être écrit ; un échec ici n'empêche pas l'installation, il est affiché.
  $verification = Join-Path $Dossier 'installation\windows\verification.txt'
  $sortie = & $Node (Join-Path $Dossier 'src\cli.js') verifier-config 2>&1 | ForEach-Object { "$_" }
  [IO.File]::WriteAllLines($verification, [string[]]$sortie, (New-Object Text.UTF8Encoding $false))
  Copy-Item $verification (Join-Path $Donnees 'journaux\verification-installation.txt') -Force
  $sortie | ForEach-Object { Write-Host $_ }

  if ($Journal) { Stop-Transcript | Out-Null }
  exit 0
} catch {
  Write-Host "ECHEC : $($_.Exception.Message)" -ForegroundColor Red
  if ($Journal) { Stop-Transcript | Out-Null }
  exit 1
}
