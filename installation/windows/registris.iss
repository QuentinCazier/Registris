; Installateur Windows de Registris, compilé par Inno Setup 6 (workflow installateur-windows.yml).
;   iscc /DVersion=x.y.z /DSource=dist\registris-x.y.z /DSortie=dist installation\windows\registris.iss
; Source contient l'application avec node_modules, node\node.exe et installation\windows\registris-service.exe.
; Installation silencieuse : /VERYSILENT /Etablissement="CH de Ville" /Port=443 /Admin=admin /Tls=auto|pfx|aucun
;   [/Pfx=chemin.pfx /PfxMotDePasse=...], mot de passe administrateur dans REGISTRIS_MOT_DE_PASSE.

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
fr.WelcomeLabel2=Ce programme installe Registris {#Version} sur cet ordinateur : l'application, Node.js, le service Windows et la configuration initiale. Rien d'autre n'est requis.

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

[UninstallRun]
Filename: "{app}\service\registris-service.exe"; Parameters: "stop"; Flags: runhidden skipifdoesntexist; RunOnceId: "ServiceStop"
Filename: "{app}\service\registris-service.exe"; Parameters: "uninstall"; Flags: runhidden skipifdoesntexist; RunOnceId: "ServiceUninstall"
Filename: "netsh.exe"; Parameters: "advfirewall firewall delete rule name=""Registris"""; Flags: runhidden; RunOnceId: "Parefeu"

[Run]
Filename: "{code:AdresseSite}"; Description: "Ouvrir Registris dans le navigateur"; Flags: postinstall shellexec nowait skipifsilent

[Code]
var
  PageEtab, PageAdmin, PagePfxMdp: TInputQueryWizardPage;
  PageTls: TInputOptionWizardPage;
  PagePfx: TInputFileWizardPage;
  EtaitMiseAJour, EchecConfiguration: Boolean;

function Donnees: String;
begin
  Result := ExpandConstant('{commonappdata}\Registris');
end;

function FichierConfig: String;
begin
  Result := Donnees + '\registris.env';
end;

// Valeur d'une clé de registris.env, ou chaîne vide.
function LireCle(const Cle: String): String;
var
  Lignes: TArrayOfString;
  I: Integer;
begin
  Result := '';
  if not LoadStringsFromFile(FichierConfig, Lignes) then Exit;
  for I := 0 to GetArrayLength(Lignes) - 1 do
    if Pos(Cle + '=', Lignes[I]) = 1 then
    begin
      Result := Copy(Lignes[I], Length(Cle) + 2, Length(Lignes[I]));
      Exit;
    end;
end;

function ServiceInstalle: Boolean;
var
  Code: Integer;
begin
  Result := Exec('sc.exe', 'query Registris', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
end;

function InitializeSetup: Boolean;
var
  Erreur: String;
begin
  EtaitMiseAJour := FileExists(FichierConfig);
  Result := True;
  if WizardSilent and not EtaitMiseAJour then
  begin
    Erreur := '';
    if Trim(ExpandConstant('{param:Etablissement|}')) = '' then Erreur := 'paramètre /Etablissement= manquant'
    else if (StrToIntDef(ExpandConstant('{param:Port|3000}'), 0) < 1) or (StrToIntDef(ExpandConstant('{param:Port|3000}'), 0) > 65535) then Erreur := 'paramètre /Port= invalide'
    else if Length(GetEnv('REGISTRIS_MOT_DE_PASSE')) < 12 then Erreur := 'variable REGISTRIS_MOT_DE_PASSE absente ou trop courte (12 caractères minimum)'
    else if (ExpandConstant('{param:Tls|auto}') = 'pfx') and not FileExists(ExpandConstant('{param:Pfx|}')) then Erreur := 'paramètre /Pfx= introuvable';
    if Erreur <> '' then
    begin
      Log('Installation silencieuse refusée : ' + Erreur);
      SuppressibleMsgBox('Installation silencieuse refusée : ' + Erreur, mbError, MB_OK, IDOK);
      Result := False;
    end;
  end;
end;

procedure InitializeWizard;
begin
  PageEtab := CreateInputQueryPage(wpSelectDir, 'Établissement', 'Nom affiché et port d''écoute',
    'Ces réglages se modifient ensuite dans ' + FichierConfig + '.');
  PageEtab.Add('Nom de l''établissement :', False);
  PageEtab.Add('Port d''écoute (443 conseillé avec HTTPS) :', False);
  PageEtab.Values[0] := ExpandConstant('{param:Etablissement|}');
  PageEtab.Values[1] := ExpandConstant('{param:Port|3000}');

  PageAdmin := CreateInputQueryPage(PageEtab.ID, 'Compte administrateur', 'Premier compte de l''application',
    'Il sert à déclarer les applications, les référents et l''annuaire. Douze caractères minimum pour le mot de passe.');
  PageAdmin.Add('Identifiant :', False);
  PageAdmin.Add('Mot de passe :', True);
  PageAdmin.Add('Confirmation :', True);
  PageAdmin.Values[0] := ExpandConstant('{param:Admin|admin}');

  PageTls := CreateInputOptionPage(PageAdmin.ID, 'Chiffrement HTTPS', 'Comment les postes atteindront Registris',
    'Les mots de passe transitent à la connexion : jamais en HTTP clair au-delà de ce serveur.', True, False);
  PageTls.Add('Générer un certificat auto-signé maintenant (le navigateur avertira jusqu''au remplacement par un certificat de votre PKI)');
  PageTls.Add('Utiliser un certificat PFX de la PKI de l''établissement');
  PageTls.Add('Pas de HTTPS ici : écoute locale seulement, derrière un reverse-proxy IIS ou nginx');
  PageTls.SelectedValueIndex := 0;

  PagePfx := CreateInputFilePage(PageTls.ID, 'Certificat PFX', 'Fichier exporté depuis la PKI',
    'Export avec l''algorithme AES256_SHA256 : Node.js refuse le chiffrement RC2 des anciens exports.');
  PagePfx.Add('Fichier PFX :', 'Certificats (*.pfx)|*.pfx|Tous les fichiers (*.*)|*.*', '.pfx');

  PagePfxMdp := CreateInputQueryPage(PagePfx.ID, 'Certificat PFX', 'Mot de passe du fichier', '');
  PagePfxMdp.Add('Mot de passe :', True);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if EtaitMiseAJour then
    Result := (PageID = PageEtab.ID) or (PageID = PageAdmin.ID) or (PageID = PageTls.ID) or (PageID = PagePfx.ID) or (PageID = PagePfxMdp.ID)
  else if (PageID = PagePfx.ID) or (PageID = PagePfxMdp.ID) then
    Result := PageTls.SelectedValueIndex <> 1;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  P: Integer;
begin
  Result := True;
  if CurPageID = PageEtab.ID then
  begin
    P := StrToIntDef(PageEtab.Values[1], 0);
    if Trim(PageEtab.Values[0]) = '' then
    begin
      MsgBox('Indiquez le nom de l''établissement.', mbError, MB_OK);
      Result := False;
    end
    else if (P < 1) or (P > 65535) then
    begin
      MsgBox('Le port doit être un nombre entre 1 et 65535.', mbError, MB_OK);
      Result := False;
    end;
  end
  else if CurPageID = PageAdmin.ID then
  begin
    if Trim(PageAdmin.Values[0]) = '' then
    begin
      MsgBox('Indiquez l''identifiant de l''administrateur.', mbError, MB_OK);
      Result := False;
    end
    else if Length(PageAdmin.Values[1]) < 12 then
    begin
      MsgBox('Le mot de passe doit faire au moins 12 caractères.', mbError, MB_OK);
      Result := False;
    end
    else if PageAdmin.Values[1] <> PageAdmin.Values[2] then
    begin
      MsgBox('Les deux saisies du mot de passe diffèrent.', mbError, MB_OK);
      Result := False;
    end;
  end
  else if CurPageID = PagePfx.ID then
  begin
    if not FileExists(PagePfx.Values[0]) then
    begin
      MsgBox('Fichier PFX introuvable.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

// Valeurs retenues : pages de l'assistant, ou paramètres de ligne de commande en mode silencieux.
function ModeTls: String;
begin
  if WizardSilent then
    Result := ExpandConstant('{param:Tls|auto}')
  else if PageTls.SelectedValueIndex = 1 then
    Result := 'pfx'
  else if PageTls.SelectedValueIndex = 2 then
    Result := 'aucun'
  else
    Result := 'auto';
end;

function Etablissement: String;
begin
  if WizardSilent then Result := ExpandConstant('{param:Etablissement|}') else Result := PageEtab.Values[0];
end;

function Port: String;
begin
  if WizardSilent then Result := ExpandConstant('{param:Port|3000}') else Result := PageEtab.Values[1];
end;

function Admin: String;
begin
  if WizardSilent then Result := ExpandConstant('{param:Admin|admin}') else Result := PageAdmin.Values[0];
end;

function MotDePasse: String;
begin
  if WizardSilent then Result := GetEnv('REGISTRIS_MOT_DE_PASSE') else Result := PageAdmin.Values[1];
end;

function Pfx: String;
begin
  if WizardSilent then Result := ExpandConstant('{param:Pfx|}') else Result := PagePfx.Values[0];
end;

function PfxMotDePasse: String;
begin
  if WizardSilent then Result := ExpandConstant('{param:PfxMotDePasse|}') else Result := PagePfxMdp.Values[0];
end;

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
    else Result := Result + S[I];
  end;
end;

// Le mot de passe ne passe ni par la ligne de commande ni par le journal : un fichier de réponses
// dans le dossier temporaire de l'installation, supprimé par configurer.ps1 après lecture.
function Configurer: Boolean;
var
  Code: Integer;
  Reponses, Params: String;
  L: TArrayOfString;
begin
  Params := '-NoProfile -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\installation\windows\configurer.ps1')
    + '" -Dossier "' + ExpandConstant('{app}') + '" -Donnees "' + Donnees
    + '" -Journal "' + ExpandConstant('{app}\installation\windows\configurer.log') + '"';
  if not EtaitMiseAJour then
  begin
    Reponses := ExpandConstant('{tmp}\reponses.json');
    SetArrayLength(L, 1);
    L[0] := '{"etablissement":"' + Json(Etablissement) + '","port":' + Port + ',"admin":"' + Json(Admin)
      + '","motDePasse":"' + Json(MotDePasse) + '","tls":"' + ModeTls + '","certificat":"' + Json(Pfx)
      + '","motDePassePfx":"' + Json(PfxMotDePasse) + '"}';
    SaveStringsToUTF8File(Reponses, L, False);
    Params := Params + ' -Reponses "' + Reponses + '"';
  end;
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  if not Result then Log('configurer.ps1 : code ' + IntToStr(Code));
end;

procedure DemarrerService;
var
  Code: Integer;
  Exe: String;
begin
  Exe := ExpandConstant('{app}\service\registris-service.exe');
  if not ServiceInstalle then Exec(Exe, 'install', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(Exe, 'start', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure OuvrirParefeu;
var
  Code: Integer;
begin
  if Exec('netsh.exe', 'advfirewall firewall show rule name="Registris"', '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0) then Exit;
  Exec('netsh.exe', 'advfirewall firewall add rule name="Registris" dir=in action=allow protocol=TCP localport=' + Port + ' profile=domain,private',
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
      if (not EtaitMiseAJour) and (ModeTls <> 'aucun') then OuvrirParefeu;
    end;
  end;
end;

function GetCustomSetupExitCode: Integer;
begin
  if EchecConfiguration then Result := 10 else Result := 0;
end;

function AdresseSite(Param: String): String;
var
  P, Tls: String;
begin
  P := LireCle('PORT');
  if P = '' then P := Port;
  Tls := LireCle('TLS_PFX') + LireCle('TLS_CERT');
  if LireCle('HOTE') = '127.0.0.1' then Result := 'http://127.0.0.1:' + P + '/'
  else if Tls <> '' then Result := 'https://' + GetComputerNameString + ':' + P + '/'
  else Result := 'http://' + GetComputerNameString + ':' + P + '/';
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
        + #13#10#13#10 + 'Adresse : ' + AdresseSite('') + #13#10 + 'Configuration : ' + FichierConfig
        + #13#10#13#10 + 'Étapes suivantes : Active Directory et courriels dans la configuration, puis les tâches planifiées (sauvegarder, ancrer, verifier, relancer) décrites dans docs\DEPLOIEMENT.md.';
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and (not UninstallSilent) then
    if MsgBox('Supprimer aussi les données de Registris (base, pièces, sauvegardes, configuration) dans ' + Donnees + ' ?',
      mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES then
      DelTree(Donnees, True, True, True);
end;
