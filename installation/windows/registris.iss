; Installateur Windows de Registris, compilé par Inno Setup 6 (workflow installateur-windows.yml).
;   iscc /DVersion=x.y.z /DSource=dist\registris-x.y.z /DSortie=dist installation\windows\registris.iss
; Source contient l'application avec node_modules, node\node.exe et installation\windows\registris-service.exe.
; Installation silencieuse : /VERYSILENT /Config=registris.env (configuration complète à reprendre)
;   ou /Etablissement="CH de Ville" /Port=443, et /Admin=admin /Tls=auto|pfx|aucun|conserver [/Pfx=... /PfxMotDePasse=...].
;   Mot de passe administrateur dans REGISTRIS_MOT_DE_PASSE. Sur une installation existante, /Config= modifie la configuration.

#ifndef Version
  #error "Version manquante : iscc /DVersion=x.y.z"
#endif
#ifndef Source
  #error "Source manquante : iscc /DSource=dossier"
#endif
#ifndef Sortie
  #define Sortie "dist"
#endif

[Setup]
AppId={{7E2B1C0A-5D3F-4B7E-9A61-3C1E2F0D8A11}
AppName=Registris
AppVersion={#Version}
AppVerName=Registris {#Version}
AppPublisher=Registris
VersionInfoProductName=Registris
VersionInfoDescription=Installateur de Registris
VersionInfoProductVersion={#Version}
AppPublisherURL=https://github.com/QuentinCazier/Registris
AppSupportURL=https://github.com/QuentinCazier/Registris/issues
DefaultDirName={autopf}\Registris
DisableProgramGroupPage=yes
LicenseFile={#Source}\LICENSE
OutputDir={#Sortie}
OutputBaseFilename=registris-{#Version}-installateur
SetupIconFile={#Source}\public\favicon.ico
UninstallDisplayIcon={app}\public\favicon.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[Messages]
fr.WelcomeLabel2=Ce programme installe Registris {#Version} sur cet ordinateur : l'application, Node.js et le service Windows. Il règle aussi l'établissement, le HTTPS, l'Active Directory, les courriels et la conservation des données, puis les contrôle. Rien d'autre n'est requis, et aucun fichier n'est à modifier ensuite.

[Files]
Source: "{#Source}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Dirs]
Name: "{commonappdata}\Registris"; Flags: uninsneveruninstall

; Mise à jour : l'arborescence de l'application est remplacée entièrement, les données sont ailleurs.
[InstallDelete]
Type: filesandordirs; Name: "{app}\node_modules"
Type: filesandordirs; Name: "{app}\src"
Type: filesandordirs; Name: "{app}\public"
Type: filesandordirs; Name: "{app}\docs"
Type: filesandordirs; Name: "{app}\node"
Type: filesandordirs; Name: "{app}\installation"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\service"
Type: files; Name: "{app}\installation\windows\configurer.log"
Type: files; Name: "{app}\installation\windows\verification.txt"

[UninstallRun]
Filename: "{app}\service\registris-service.exe"; Parameters: "stop"; Flags: runhidden skipifdoesntexist; RunOnceId: "ServiceStop"
Filename: "{app}\service\registris-service.exe"; Parameters: "uninstall"; Flags: runhidden skipifdoesntexist; RunOnceId: "ServiceUninstall"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Registris"""; Flags: runhidden; RunOnceId: "Parefeu"

[Run]
Filename: "{code:AdresseSite}"; Description: "Ouvrir Registris dans le navigateur"; Flags: postinstall shellexec nowait skipifsilent

[Code]
var
  PageDepart, PageTls, PageAuth: TInputOptionWizardPage;
  PageImport, PagePfx, PageCa: TInputFileWizardPage;
  PageEtab, PageAdmin, PagePfxMdp, PageLdap, PageGroupes, PageSmtp, PageOptions: TInputQueryWizardPage;
  CheckImbriques, CheckSmtpTls: TNewCheckBox;
  EtaitMiseAJour, EchecConfiguration, Prerempli: Boolean;
  Base: TArrayOfString;

function Donnees: String;
begin
  Result := ExpandConstant('{commonappdata}\Registris');
end;

function FichierConfig: String;
begin
  Result := Donnees + '\registris.env';
end;

// Valeur d'une clé dans les lignes d'un fichier de configuration, comme l'application la lit.
function ValeurDe(const Lignes: TArrayOfString; const Cle: String): String;
var
  I, P: Integer;
  L: String;
begin
  Result := '';
  for I := 0 to GetArrayLength(Lignes) - 1 do
  begin
    L := Trim(Lignes[I]);
    if (L = '') or (Copy(L, 1, 1) = '#') then Continue;
    P := Pos('=', L);
    if (P > 1) and (Trim(Copy(L, 1, P - 1)) = Cle) then
    begin
      Result := Trim(Copy(L, P + 1, Length(L)));
      if (Length(Result) >= 2) and ((Result[1] = '"') or (Result[1] = '''')) and (Result[Length(Result)] = Result[1]) then
        Result := Copy(Result, 2, Length(Result) - 2);
    end;
  end;
end;

function LireCle(const Cle: String): String;
var
  Lignes: TArrayOfString;
begin
  Result := '';
  if LoadStringsFromFile(FichierConfig, Lignes) then Result := ValeurDe(Lignes, Cle);
end;

function ServiceInstalle: Boolean;
var
  Code: Integer;
begin
  Result := Exec('sc.exe', 'query Registris', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

// --- Mode de l'installation -------------------------------------------------------------------------

function ImportChoisi: Boolean;
begin
  if WizardSilent then Result := ExpandConstant('{param:Config|}') <> ''
  else Result := (not EtaitMiseAJour) and (PageDepart.SelectedValueIndex = 1);
end;

function ModeConfig: String;
begin
  if not EtaitMiseAJour then Result := 'installer'
  else if WizardSilent then
  begin
    if ImportChoisi then Result := 'modifier' else Result := 'conserver';
  end
  else if PageDepart.SelectedValueIndex = 1 then Result := 'modifier'
  else Result := 'conserver';
end;

function PagesConfigVisibles: Boolean;
begin
  Result := (not WizardSilent) and (ModeConfig <> 'conserver');
end;

function AnnuaireChoisi: Boolean;
begin
  Result := PageAuth.SelectedValueIndex = 0;
end;

function InitializeSetup: Boolean;
var
  Erreur, Config: String;
begin
  EtaitMiseAJour := FileExists(FichierConfig);
  Result := True;
  if WizardSilent then
  begin
    Erreur := '';
    Config := ExpandConstant('{param:Config|}');
    if (Config <> '') and not FileExists(Config) then Erreur := 'fichier /Config= introuvable'
    else if not EtaitMiseAJour then
    begin
      if (Trim(ExpandConstant('{param:Etablissement|}')) = '') and (Config = '') then Erreur := 'paramètre /Etablissement= ou /Config= manquant'
      else if Length(GetEnv('REGISTRIS_MOT_DE_PASSE')) < 12 then Erreur := 'variable REGISTRIS_MOT_DE_PASSE absente ou trop courte (12 caractères minimum)'
      else if (ExpandConstant('{param:Tls|}') = 'pfx') and not FileExists(ExpandConstant('{param:Pfx|}')) then Erreur := 'paramètre /Pfx= introuvable';
    end;
    if Erreur <> '' then
    begin
      Log('Installation silencieuse refusée : ' + Erreur);
      SuppressibleMsgBox('Installation silencieuse refusée : ' + Erreur, mbError, MB_OK, IDOK);
      Result := False;
    end;
  end;
end;

// --- Pages ------------------------------------------------------------------------------------------

function CaseSous(Page: TInputQueryWizardPage; Dernier: Integer; const Libelle: String): TNewCheckBox;
begin
  Result := TNewCheckBox.Create(Page);
  Result.Parent := Page.Surface;
  Result.Top := Page.Edits[Dernier].Top + Page.Edits[Dernier].Height + ScaleY(12);
  Result.Width := Page.SurfaceWidth;
  Result.Height := ScaleY(17);
  Result.Caption := Libelle;
end;

procedure InitializeWizard;
begin
  PageDepart := CreateInputOptionPage(wpSelectDir, 'Configuration', 'Point de départ', '', True, False);
  if EtaitMiseAJour then
  begin
    PageDepart.SubCaptionLabel.Caption := 'Registris est déjà installé sur ce serveur. Sa configuration et ses données sont conservées.';
    PageDepart.Add('Mettre à jour en gardant la configuration actuelle (conseillé)');
    PageDepart.Add('Mettre à jour et modifier la configuration : annuaire, courriels, HTTPS, conservation');
  end
  else
  begin
    PageDepart.SubCaptionLabel.Caption := 'Tout se règle maintenant, sans fichier à modifier ensuite.';
    PageDepart.Add('Configurer pas à pas (conseillé)');
    PageDepart.Add('Reprendre un fichier de configuration existant (registris.env ou .env), puis le relire page par page');
  end;
  PageDepart.SelectedValueIndex := 0;

  PageImport := CreateInputFilePage(PageDepart.ID, 'Configuration', 'Fichier à reprendre',
    'Ses réglages préremplissent les pages suivantes. Les chemins des données restent ceux de ce serveur.');
  PageImport.Add('Fichier de configuration :', 'Configuration (*.env)|*.env|Tous les fichiers (*.*)|*.*', '.env');

  PageEtab := CreateInputQueryPage(PageImport.ID, 'Établissement', 'Nom affiché et accès',
    'Le nom apparaît en haut de chaque page. Le port est celui que les postes utiliseront.');
  PageEtab.Add('Nom de l''établissement :', False);
  PageEtab.Add('Port d''écoute (443 conseillé avec HTTPS) :', False);
  PageEtab.Values[0] := ExpandConstant('{param:Etablissement|}');
  PageEtab.Values[1] := ExpandConstant('{param:Port|443}');

  PageAdmin := CreateInputQueryPage(PageEtab.ID, 'Compte administrateur', 'Premier compte de l''application',
    'Il déclare les applications, les référents et les services. Avec l''Active Directory, il reste utilisable si l''annuaire est injoignable. Douze caractères minimum.');
  PageAdmin.Add('Identifiant :', False);
  PageAdmin.Add('Mot de passe :', True);
  PageAdmin.Add('Confirmation :', True);
  PageAdmin.Values[0] := ExpandConstant('{param:Admin|admin}');

  PageTls := CreateInputOptionPage(PageAdmin.ID, 'Chiffrement HTTPS', 'Comment les postes atteindront Registris',
    'Les mots de passe transitent à la connexion : jamais en HTTP clair au-delà de ce serveur.', True, False);
  PageTls.Add('Garder le certificat déjà configuré');
  PageTls.Add('Générer un certificat auto-signé (le navigateur avertira jusqu''au remplacement par un certificat de votre PKI)');
  PageTls.Add('Utiliser un certificat PFX de la PKI de l''établissement');
  PageTls.Add('Pas de HTTPS ici : écoute locale seulement, derrière un reverse-proxy IIS ou nginx');
  PageTls.CheckListBox.ItemEnabled[0] := False;
  PageTls.SelectedValueIndex := 1;

  PagePfx := CreateInputFilePage(PageTls.ID, 'Certificat PFX', 'Fichier exporté depuis la PKI',
    'Export avec l''algorithme AES256_SHA256 : Node.js refuse le chiffrement RC2 des anciens exports.');
  PagePfx.Add('Fichier PFX :', 'Certificats (*.pfx;*.p12)|*.pfx;*.p12|Tous les fichiers (*.*)|*.*', '.pfx');

  PagePfxMdp := CreateInputQueryPage(PagePfx.ID, 'Certificat PFX', 'Mot de passe du fichier', '');
  PagePfxMdp.Add('Mot de passe :', True);

  PageAuth := CreateInputOptionPage(PagePfxMdp.ID, 'Connexion des agents', 'Comment les agents s''identifient', '', True, False);
  PageAuth.Add('Active Directory : les agents utilisent leur compte Windows (conseillé)');
  PageAuth.Add('Comptes propres à Registris, créés un par un (pour démarrer ou tester)');
  PageAuth.SelectedValueIndex := 0;

  PageLdap := CreateInputQueryPage(PageAuth.ID, 'Active Directory', 'Serveur et compte de service',
    'Le compte de service, en lecture seule, retrouve les agents et leurs groupes.');
  PageLdap.Add('Serveur (ex. ldaps://dc1.etablissement.local:636) :', False);
  PageLdap.Add('Base de recherche (ex. DC=etablissement,DC=local) :', False);
  PageLdap.Add('Compte de service (ex. CN=svc_registris,OU=Services,DC=etablissement,DC=local) :', False);
  PageLdap.Add('Mot de passe du compte de service :', True);

  PageGroupes := CreateInputQueryPage(PageLdap.ID, 'Active Directory', 'Groupes qui donnent un rôle',
    'Nom exact (CN) ou chemin complet (DN) de chaque groupe. Un groupe laissé vide ne donne pas ce rôle.');
  PageGroupes.Add('Administrateurs :', False);
  PageGroupes.Add('Référents applicatifs :', False);
  PageGroupes.Add('Contrôleurs, auditeurs :', False);
  PageGroupes.Add('Agents qui déposent des demandes :', False);
  PageGroupes.Values[0] := 'GG_Registris_Admin';
  PageGroupes.Values[1] := 'GG_Registris_Referent';
  PageGroupes.Values[2] := 'GG_Registris_Controleur';
  PageGroupes.Values[3] := 'GG_Registris_Utilisateur';
  CheckImbriques := CaseSous(PageGroupes, 3, 'Tenir compte des groupes imbriqués (un groupe membre d''un de ces groupes)');

  PageCa := CreateInputFilePage(PageGroupes.ID, 'Active Directory', 'Certificat de l''autorité',
    'Facultatif : le certificat (.pem, .cer ou .crt) de l''autorité qui a émis celui du contrôleur de domaine, si Windows ne le connaît pas déjà.');
  PageCa.Add('Certificat de l''autorité :', 'Certificats (*.pem;*.cer;*.crt)|*.pem;*.cer;*.crt|Tous les fichiers (*.*)|*.*', '.pem');

  PageSmtp := CreateInputQueryPage(PageCa.ID, 'Courriels', 'Relais de messagerie interne',
    'Laisser le serveur vide pour ne rien envoyer. Le compte est facultatif avec un relais Exchange interne.');
  PageSmtp.Add('Serveur (ex. smtp.etablissement.local, ou smtp.etablissement.local:587) :', False);
  PageSmtp.Add('Adresse d''expédition (ex. registris@etablissement.fr) :', False);
  PageSmtp.Add('Compte (facultatif) :', False);
  PageSmtp.Add('Mot de passe du compte :', True);
  CheckSmtpTls := CaseSous(PageSmtp, 3, 'Connexion chiffrée dès l''ouverture (port 465)');

  PageOptions := CreateInputQueryPage(PageSmtp.ID, 'Fonctionnement', 'Relances, conservation et adresse',
    'La durée de conservation se décide avec le délégué à la protection des données (voir docs\RGPD.md).');
  PageOptions.Add('Relancer une demande en attente après (jours) :', False);
  PageOptions.Add('Conserver les données d''un agent parti pendant (années) :', False);
  PageOptions.Add('Adresse des liens envoyés par courriel (laisser vide pour la calculer) :', False);
  PageOptions.Values[0] := '7';
  PageOptions.Values[1] := '5';

  Prerempli := False;
  if EtaitMiseAJour and LoadStringsFromFile(FichierConfig, Base) then Prerempli := True;
end;

// Préremplit les pages depuis une configuration lue (existante ou reprise).
procedure Preremplir;
var
  Serveur, Port: String;
begin
  if ValeurDe(Base, 'NOM_ETABLISSEMENT') <> '' then PageEtab.Values[0] := ValeurDe(Base, 'NOM_ETABLISSEMENT');
  if ValeurDe(Base, 'PORT') <> '' then PageEtab.Values[1] := ValeurDe(Base, 'PORT');
  if (ValeurDe(Base, 'TLS_PFX') <> '') or (ValeurDe(Base, 'TLS_CERT') <> '') then
  begin
    if FileExists(ValeurDe(Base, 'TLS_PFX')) or FileExists(ValeurDe(Base, 'TLS_CERT')) then
    begin
      PageTls.CheckListBox.ItemEnabled[0] := True;
      PageTls.SelectedValueIndex := 0;
    end;
  end
  else if ValeurDe(Base, 'HOTE') = '127.0.0.1' then PageTls.SelectedValueIndex := 3;
  if Lowercase(ValeurDe(Base, 'AUTH_MODE')) = 'ldap' then PageAuth.SelectedValueIndex := 0 else PageAuth.SelectedValueIndex := 1;
  PageLdap.Values[0] := ValeurDe(Base, 'LDAP_URL');
  PageLdap.Values[1] := ValeurDe(Base, 'LDAP_SEARCH_BASE');
  if PageLdap.Values[1] = '' then PageLdap.Values[1] := ValeurDe(Base, 'LDAP_BASE_DN');
  PageLdap.Values[2] := ValeurDe(Base, 'LDAP_BIND_DN');
  if ValeurDe(Base, 'LDAP_BIND_PASSWORD') <> '' then PageLdap.PromptLabels[3].Caption := 'Mot de passe du compte de service (vide : garder celui déjà enregistré) :';
  if ValeurDe(Base, 'LDAP_GROUPE_ADMIN') <> '' then PageGroupes.Values[0] := ValeurDe(Base, 'LDAP_GROUPE_ADMIN');
  if ValeurDe(Base, 'LDAP_GROUPE_REFERENT') <> '' then PageGroupes.Values[1] := ValeurDe(Base, 'LDAP_GROUPE_REFERENT');
  if ValeurDe(Base, 'LDAP_GROUPE_CONTROLEUR') <> '' then PageGroupes.Values[2] := ValeurDe(Base, 'LDAP_GROUPE_CONTROLEUR');
  if ValeurDe(Base, 'LDAP_GROUPE_UTILISATEUR') <> '' then PageGroupes.Values[3] := ValeurDe(Base, 'LDAP_GROUPE_UTILISATEUR');
  CheckImbriques.Checked := Lowercase(ValeurDe(Base, 'LDAP_GROUPES_IMBRIQUES')) = 'true';
  if FileExists(ValeurDe(Base, 'LDAP_CA_CERT')) then PageCa.Values[0] := ValeurDe(Base, 'LDAP_CA_CERT');
  Serveur := ValeurDe(Base, 'SMTP_HOST');
  Port := ValeurDe(Base, 'SMTP_PORT');
  if (Serveur <> '') and (Port <> '') and (Port <> '25') then Serveur := Serveur + ':' + Port;
  PageSmtp.Values[0] := Serveur;
  PageSmtp.Values[1] := ValeurDe(Base, 'SMTP_FROM');
  PageSmtp.Values[2] := ValeurDe(Base, 'SMTP_USER');
  if ValeurDe(Base, 'SMTP_PASSWORD') <> '' then PageSmtp.PromptLabels[3].Caption := 'Mot de passe du compte (vide : garder celui déjà enregistré) :';
  CheckSmtpTls.Checked := Lowercase(ValeurDe(Base, 'SMTP_SECURE')) = 'true';
  if ValeurDe(Base, 'RELANCE_JOURS') <> '' then PageOptions.Values[0] := ValeurDe(Base, 'RELANCE_JOURS');
  if ValeurDe(Base, 'CONSERVATION_ANNEES') <> '' then PageOptions.Values[1] := ValeurDe(Base, 'CONSERVATION_ANNEES');
  PageOptions.Values[2] := ValeurDe(Base, 'APP_URL');
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = PageImport.ID then Result := not ImportChoisi
  else if (PageID = PageEtab.ID) or (PageID = PageTls.ID) or (PageID = PageAuth.ID) or (PageID = PageSmtp.ID) or (PageID = PageOptions.ID) then
    Result := ModeConfig = 'conserver'
  else if PageID = PageAdmin.ID then Result := EtaitMiseAJour
  else if (PageID = PagePfx.ID) or (PageID = PagePfxMdp.ID) then Result := (ModeConfig = 'conserver') or (PageTls.SelectedValueIndex <> 2)
  else if (PageID = PageLdap.ID) or (PageID = PageGroupes.ID) or (PageID = PageCa.ID) then Result := (ModeConfig = 'conserver') or not AnnuaireChoisi;
end;

function Erreur(const Message: String): Boolean;
begin
  MsgBox(Message, mbError, MB_OK);
  Result := False;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  P: Integer;
begin
  Result := True;
  // En silencieux, les paramètres sont contrôlés par InitializeSetup : les pages restent vides.
  if WizardSilent then Exit;
  if (CurPageID = PageDepart.ID) and EtaitMiseAJour and Prerempli then Preremplir
  else if CurPageID = PageImport.ID then
  begin
    if not LoadStringsFromFile(PageImport.Values[0], Base) then Result := Erreur('Fichier illisible.')
    else if ValeurDe(Base, 'NOM_ETABLISSEMENT') + ValeurDe(Base, 'AUTH_MODE') + ValeurDe(Base, 'PORT') = '' then
      Result := Erreur('Ce fichier ne ressemble pas à une configuration de Registris (ni NOM_ETABLISSEMENT, ni AUTH_MODE, ni PORT).')
    else Preremplir;
  end
  else if CurPageID = PageEtab.ID then
  begin
    P := StrToIntDef(PageEtab.Values[1], 0);
    if Trim(PageEtab.Values[0]) = '' then Result := Erreur('Indiquez le nom de l''établissement.')
    else if (P < 1) or (P > 65535) then Result := Erreur('Le port doit être un nombre entre 1 et 65535.');
  end
  else if CurPageID = PageAdmin.ID then
  begin
    if Trim(PageAdmin.Values[0]) = '' then Result := Erreur('Indiquez l''identifiant de l''administrateur.')
    else if Length(PageAdmin.Values[1]) < 12 then Result := Erreur('Le mot de passe doit faire au moins 12 caractères.')
    else if PageAdmin.Values[1] <> PageAdmin.Values[2] then Result := Erreur('Les deux saisies du mot de passe diffèrent.');
  end
  else if CurPageID = PagePfx.ID then
  begin
    if not FileExists(PagePfx.Values[0]) then Result := Erreur('Fichier PFX introuvable.');
  end
  else if CurPageID = PageLdap.ID then
  begin
    if Pos('ldap', Lowercase(PageLdap.Values[0])) <> 1 then Result := Erreur('Le serveur commence par ldaps:// (ou ldap:// sans chiffrement, déconseillé).')
    else if Trim(PageLdap.Values[1]) = '' then Result := Erreur('Indiquez la base de recherche, par exemple DC=etablissement,DC=local.')
    else if Trim(PageLdap.Values[2]) = '' then Result := Erreur('Indiquez le compte de service.')
    else if (PageLdap.Values[3] = '') and (ValeurDe(Base, 'LDAP_BIND_PASSWORD') = '') then Result := Erreur('Indiquez le mot de passe du compte de service.');
  end
  else if CurPageID = PageGroupes.ID then
  begin
    if Trim(PageGroupes.Values[0] + PageGroupes.Values[1] + PageGroupes.Values[2] + PageGroupes.Values[3]) = '' then
      Result := Erreur('Indiquez au moins un groupe : sans groupe, personne ne pourrait se connecter par l''annuaire.');
  end
  else if CurPageID = PageCa.ID then
  begin
    if (PageCa.Values[0] <> '') and not FileExists(PageCa.Values[0]) then Result := Erreur('Certificat de l''autorité introuvable.');
  end
  else if CurPageID = PageSmtp.ID then
  begin
    if (Trim(PageSmtp.Values[0]) <> '') and (Pos('@', PageSmtp.Values[1]) = 0) then Result := Erreur('Indiquez l''adresse d''expédition des courriels.');
  end
  else if CurPageID = PageOptions.ID then
  begin
    if StrToIntDef(PageOptions.Values[0], 0) < 1 then Result := Erreur('Le délai de relance est un nombre de jours, 1 au moins.')
    else if StrToIntDef(PageOptions.Values[1], 0) < 1 then Result := Erreur('La durée de conservation est un nombre d''années, 1 au moins.');
  end;
end;

// --- Réponses transmises à configurer.ps1 ----------------------------------------------------------

function Json(const S: String): String;
var
  I: Integer;
begin
  Result := '';
  for I := 1 to Length(S) do
  begin
    if (S[I] = '"') or (S[I] = '\') then Result := Result + '\' + S[I]
    else if S[I] = #10 then Result := Result + '\n'
    else if S[I] = #13 then Result := Result + '\r'
    else if S[I] = #9 then Result := Result + '\t'
    else Result := Result + S[I];
  end;
end;

procedure Ajouter(var S: String; const Cle, Valeur: String);
begin
  if S <> '' then S := S + ',';
  S := S + '"' + Cle + '":"' + Json(Valeur) + '"';
end;

// Seulement ce qui change : une valeur non touchée reste telle quelle dans le fichier, accents compris.
procedure AjouterSiChange(var S: String; const Cle, Valeur: String);
begin
  if Valeur <> ValeurDe(Base, Cle) then Ajouter(S, Cle, Valeur);
end;

function Champ(const Valeur, Cle: String): String;
begin
  if Valeur = ValeurDe(Base, Cle) then Result := '' else Result := Valeur;
end;

function Booleen(B: Boolean): String;
begin
  if B then Result := 'true' else Result := 'false';
end;

function ModeTls: String;
begin
  if WizardSilent then Result := ExpandConstant('{param:Tls|}')
  else case PageTls.SelectedValueIndex of
    0: Result := 'conserver';
    2: Result := 'pfx';
    3: Result := 'aucun';
  else
    Result := 'auto';
  end;
end;

function Parametres: String;
var
  Serveur, Port: String;
  P: Integer;
begin
  Result := '';
  if not PagesConfigVisibles then Exit;
  if AnnuaireChoisi then
  begin
    AjouterSiChange(Result, 'AUTH_MODE', 'ldap');
    AjouterSiChange(Result, 'LDAP_URL', Trim(PageLdap.Values[0]));
    AjouterSiChange(Result, 'LDAP_BASE_DN', Trim(PageLdap.Values[1]));
    AjouterSiChange(Result, 'LDAP_SEARCH_BASE', Trim(PageLdap.Values[1]));
    AjouterSiChange(Result, 'LDAP_BIND_DN', Trim(PageLdap.Values[2]));
    if PageLdap.Values[3] <> '' then AjouterSiChange(Result, 'LDAP_BIND_PASSWORD', PageLdap.Values[3]);
    AjouterSiChange(Result, 'LDAP_GROUPE_ADMIN', Trim(PageGroupes.Values[0]));
    AjouterSiChange(Result, 'LDAP_GROUPE_REFERENT', Trim(PageGroupes.Values[1]));
    AjouterSiChange(Result, 'LDAP_GROUPE_CONTROLEUR', Trim(PageGroupes.Values[2]));
    AjouterSiChange(Result, 'LDAP_GROUPE_UTILISATEUR', Trim(PageGroupes.Values[3]));
    AjouterSiChange(Result, 'LDAP_GROUPES_IMBRIQUES', Booleen(CheckImbriques.Checked));
  end
  else AjouterSiChange(Result, 'AUTH_MODE', 'local');
  Serveur := Trim(PageSmtp.Values[0]);
  Port := '';
  P := Pos(':', Serveur);
  if P > 0 then
  begin
    Port := Copy(Serveur, P + 1, Length(Serveur));
    Serveur := Copy(Serveur, 1, P - 1);
  end;
  if Port = '' then
  begin
    if CheckSmtpTls.Checked then Port := '465' else Port := '25';
  end;
  AjouterSiChange(Result, 'SMTP_HOST', Serveur);
  if Serveur <> '' then
  begin
    AjouterSiChange(Result, 'SMTP_PORT', Port);
    AjouterSiChange(Result, 'SMTP_FROM', Trim(PageSmtp.Values[1]));
    AjouterSiChange(Result, 'SMTP_USER', Trim(PageSmtp.Values[2]));
    if PageSmtp.Values[3] <> '' then AjouterSiChange(Result, 'SMTP_PASSWORD', PageSmtp.Values[3]);
    AjouterSiChange(Result, 'SMTP_SECURE', Booleen(CheckSmtpTls.Checked));
  end;
  AjouterSiChange(Result, 'RELANCE_JOURS', Trim(PageOptions.Values[0]));
  AjouterSiChange(Result, 'CONSERVATION_ANNEES', Trim(PageOptions.Values[1]));
  AjouterSiChange(Result, 'APP_URL', Trim(PageOptions.Values[2]));
end;

// Les mots de passe ne passent ni par la ligne de commande ni par le journal : un fichier de réponses
// dans le dossier temporaire de l'installation, supprimé par configurer.ps1 après lecture.
function Configurer: Boolean;
var
  Code: Integer;
  Reponses, Params, J, Importer: String;
  L: TArrayOfString;
begin
  Reponses := ExpandConstant('{tmp}\reponses.json');
  J := '"mode":"' + ModeConfig + '"';
  if WizardSilent then Importer := ExpandConstant('{param:Config|}')
  else if ImportChoisi then Importer := PageImport.Values[0]
  else Importer := '';
  if Importer <> '' then J := J + ',"importer":"' + Json(Importer) + '"';
  if ModeConfig <> 'conserver' then
  begin
    if WizardSilent then
    begin
      J := J + ',"etablissement":"' + Json(ExpandConstant('{param:Etablissement|}')) + '","port":"' + Json(ExpandConstant('{param:Port|}')) + '"';
      J := J + ',"certificat":"' + Json(ExpandConstant('{param:Pfx|}')) + '","motDePassePfx":"' + Json(ExpandConstant('{param:PfxMotDePasse|}')) + '"';
    end
    else
    begin
      J := J + ',"etablissement":"' + Json(Champ(Trim(PageEtab.Values[0]), 'NOM_ETABLISSEMENT')) + '","port":"' + Json(Champ(Trim(PageEtab.Values[1]), 'PORT')) + '"';
      J := J + ',"certificat":"' + Json(PagePfx.Values[0]) + '","motDePassePfx":"' + Json(PagePfxMdp.Values[0]) + '"';
      if AnnuaireChoisi and (PageCa.Values[0] <> '') then J := J + ',"caAnnuaire":"' + Json(PageCa.Values[0]) + '"';
    end;
    J := J + ',"tls":"' + ModeTls + '"';
    J := J + ',"parametres":{' + Parametres + '}';
  end;
  if not EtaitMiseAJour then
  begin
    if WizardSilent then
      J := J + ',"admin":"' + Json(ExpandConstant('{param:Admin|admin}')) + '","motDePasse":"' + Json(GetEnv('REGISTRIS_MOT_DE_PASSE')) + '"'
    else
      J := J + ',"admin":"' + Json(PageAdmin.Values[0]) + '","motDePasse":"' + Json(PageAdmin.Values[1]) + '"';
  end;
  SetArrayLength(L, 1);
  L[0] := '{' + J + '}';
  SaveStringsToUTF8File(Reponses, L, False);
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installation\windows\configurer.ps1')
    + '" -Dossier "' + ExpandConstant('{app}') + '" -Donnees "' + Donnees
    + '" -Journal "' + ExpandConstant('{app}\installation\windows\configurer.log') + '" -Reponses "' + Reponses + '"';
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  if not Result then Log('configurer.ps1 : code ' + IntToStr(Code));
  if FileExists(Reponses) then DeleteFile(Reponses);
end;

// --- Service, pare-feu, pages finales ---------------------------------------------------------------

procedure DemarrerService;
var
  Code: Integer;
  Exe: String;
begin
  Exe := ExpandConstant('{app}\service\registris-service.exe');
  if not ServiceInstalle then Exec(Exe, 'install', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(Exe, 'start', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

// Règle refaite à chaque passage : le port a pu changer.
procedure OuvrirParefeu;
var
  Code: Integer;
begin
  Exec('netsh.exe', 'advfirewall firewall delete rule name="Registris"', '', SW_HIDE, ewWaitUntilTerminated, Code);
  if LireCle('HOTE') = '127.0.0.1' then Exit;
  Exec('netsh.exe', 'advfirewall firewall add rule name="Registris" dir=in action=allow protocol=TCP localport=' + LireCle('PORT') + ' profile=domain,private',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Result := '';
  if ServiceInstalle then
  begin
    if FileExists(ExpandConstant('{app}\service\registris-service.exe')) then
      Exec(ExpandConstant('{app}\service\registris-service.exe'), 'stop', '', SW_HIDE, ewWaitUntilTerminated, Code)
    else
      Exec('sc.exe', 'stop Registris', '', SW_HIDE, ewWaitUntilTerminated, Code);
    Sleep(3000);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    EchecConfiguration := not Configurer;
    if EchecConfiguration then
      SuppressibleMsgBox('La configuration a échoué. Détails dans ' + ExpandConstant('{app}\installation\windows\configurer.log'), mbError, MB_OK, IDOK)
    else
    begin
      DemarrerService;
      OuvrirParefeu;
    end;
  end;
end;

function GetCustomSetupExitCode: Integer;
begin
  if EchecConfiguration then Result := 10 else Result := 0;
end;

function AdresseSite(Param: String): String;
var
  P: String;
begin
  Result := LireCle('APP_URL');
  if Result <> '' then
  begin
    Result := Result + '/';
    Exit;
  end;
  P := LireCle('PORT');
  if LireCle('HOTE') = '127.0.0.1' then Result := 'http://127.0.0.1:' + P + '/'
  else if LireCle('TLS_PFX') + LireCle('TLS_CERT') <> '' then Result := 'https://' + GetComputerNameString + ':' + P + '/'
  else Result := 'http://' + GetComputerNameString + ':' + P + '/';
end;

// Le contrôle de la configuration, écrit par configurer.ps1 : les échecs d'abord.
function BilanVerification: String;
var
  Lignes: TArrayOfString;
  I, Echecs: Integer;
begin
  Result := '';
  Echecs := 0;
  if not LoadStringsFromFile(ExpandConstant('{app}\installation\windows\verification.txt'), Lignes) then Exit;
  for I := 0 to GetArrayLength(Lignes) - 1 do
    if Pos('ECHEC', Lignes[I]) = 1 then
    begin
      Echecs := Echecs + 1;
      if Echecs <= 4 then Result := Result + #13#10 + '- ' + Trim(Copy(Lignes[I], 6, Length(Lignes[I])));
    end;
  if Echecs = 0 then Result := #13#10#13#10 + 'Contrôle de la configuration : annuaire, courriels et certificat répondent.'
  else Result := #13#10#13#10 + 'À corriger (' + IntToStr(Echecs) + ') :' + Result + #13#10 + 'Détail dans Administration, Configuration. Relancez l''installateur pour modifier.';
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
  begin
    if EchecConfiguration then
      WizardForm.FinishedLabel.Caption := 'Les fichiers sont en place mais la configuration a échoué : voir '
        + ExpandConstant('{app}\installation\windows\configurer.log') + ', puis relancer l''installateur.'
    else
      WizardForm.FinishedLabel.Caption := 'Registris {#Version} est installé et le service Windows « Registris » démarré.'
        + #13#10#13#10 + 'Adresse : ' + AdresseSite('') + #13#10 + 'Configuration : ' + FichierConfig + BilanVerification;
  end;
end;

function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo, MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := MemoDirInfo + NewLine + NewLine;
  if ModeConfig = 'conserver' then
  begin
    Result := Result + 'Configuration : conservée telle quelle' + NewLine + Space + FichierConfig;
    Exit;
  end;
  Result := Result + 'Établissement :' + NewLine + Space + PageEtab.Values[0] + ', port ' + PageEtab.Values[1] + NewLine;
  case PageTls.SelectedValueIndex of
    0: Result := Result + 'HTTPS : certificat déjà configuré' + NewLine;
    1: Result := Result + 'HTTPS : certificat auto-signé généré' + NewLine;
    2: Result := Result + 'HTTPS : ' + PagePfx.Values[0] + NewLine;
  else
    Result := Result + 'HTTPS : aucun, derrière un reverse-proxy' + NewLine;
  end;
  if AnnuaireChoisi then
    Result := Result + 'Connexion : Active Directory' + NewLine + Space + PageLdap.Values[0] + NewLine + Space + PageLdap.Values[2] + NewLine
  else
    Result := Result + 'Connexion : comptes propres à Registris' + NewLine;
  if Trim(PageSmtp.Values[0]) <> '' then Result := Result + 'Courriels : ' + PageSmtp.Values[0] + ', expéditeur ' + PageSmtp.Values[1] + NewLine
  else Result := Result + 'Courriels : désactivés' + NewLine;
  Result := Result + 'Relance après ' + PageOptions.Values[0] + ' jours, conservation ' + PageOptions.Values[1] + ' ans' + NewLine;
  if not EtaitMiseAJour then Result := Result + 'Administrateur : ' + PageAdmin.Values[0] + NewLine;
  Result := Result + NewLine + 'La configuration sera contrôlée à la fin de l''installation.';
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
    if MsgBox('Supprimer aussi les données de Registris (base, pièces, sauvegardes, configuration) dans ' + Donnees + ' ?',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(Donnees, True, True, True);
end;
