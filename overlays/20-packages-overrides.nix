{self}: final: prev: {
  nixosOptionsDoc = args: let
    nixpkgsPrefix = "${toString prev.path}/";
    normalizeDeclaration = declaration:
      if builtins.isAttrs declaration
      then declaration
      else let
        declarationPath = toString declaration;
        relativePath = final.lib.removePrefix nixpkgsPrefix declarationPath;
      in
        if final.lib.hasPrefix nixpkgsPrefix declarationPath
        then {
          name = relativePath;
          url = "https://github.com/NixOS/nixpkgs/blob/${self.inputs.nixpkgs.rev}/${relativePath}";
        }
        else declaration;
  in
    prev.nixosOptionsDoc (args
      // {
        transformOptions = option: let
          transformedOption = (args.transformOptions or final.lib.id) option;
        in
          transformedOption
          // {
            declarations = map normalizeDeclaration transformedOption.declarations;
          };
      });

  atuin = let
    testBash = final.writeShellScriptBin "bash" ''
      export NOSYSBASHRC=1
      exec ${final.lib.getExe final.bashInteractive} "$@"
    '';
  in
    prev.atuin.overrideAttrs (final.lib.optionalAttrs prev.stdenv.hostPlatform.isDarwin {
      ATUIN_E2E_BASH = final.lib.getExe testBash;
    });

  container = final.stdenvNoCC.mkDerivation (finalAttrs: {
    pname = "container";
    version = "1.0.0";
    src = final.fetchurl {
      url = "https://github.com/apple/container/releases/download/${finalAttrs.version}/container-${finalAttrs.version}-installer-signed.pkg";
      hash = "sha256-E/RfJtqUw1Sty+/h6PdjHn8SbpPF1N1qWlOKpmtPR50=";
    };

    nativeBuildInputs = [
      final.libarchive
      final.xar
      final.installShellFiles
    ];

    dontUnpack = true;
    dontConfigure = true;
    dontBuild = true;
    dontFixup = true;

    installPhase = ''
      runHook preInstall

      mkdir -p "$out"
      xar -xf "$src" Payload
      bsdtar --extract --file Payload --directory "$out"

      runHook postInstall
    '';

    postInstall = final.lib.optionalString (final.stdenvNoCC.buildPlatform.canExecute final.stdenvNoCC.hostPlatform) ''
      installShellCompletion --cmd container \
        --bash <("$out/bin/container" --generate-completion-script bash) \
        --fish <("$out/bin/container" --generate-completion-script fish) \
        --zsh <("$out/bin/container" --generate-completion-script zsh)
    '';

    nativeInstallCheckInputs = [final.versionCheckHook];
    doInstallCheck = true;

    meta =
      prev.container.meta
      // {
        changelog = "https://github.com/apple/container/releases/tag/${finalAttrs.version}";
        sourceProvenance = [final.lib.sourceTypes.binaryNativeCode];
      };
  });

  fzf = prev.fzf.overrideAttrs (oldAttrs: {
    postPatch =
      (oldAttrs.postPatch or "")
      + final.lib.optionalString (oldAttrs.version == "0.74.5") ''
        # Seed the expired fragment so the second-chance read does not race the scheduler.
        substituteInPlace src/tui/light_query_test.go \
          --replace-fail 'inW.WriteString("\x1b[12")
        ${"\t"}go func() {
        ${"\t\t"}time.Sleep(2 * defaultEscDelay * time.Millisecond)
        ${"\t\t"}inW.WriteString("x")
        ${"\t\t"}time.Sleep(2 * defaultEscDelay * time.Millisecond)
        ${"\t\t"}inW.WriteString("y") // ends the wait if x was dropped
        ${"\t"}}()' 'if _, err := inW.WriteString("xy"); err != nil {
        ${"\t\t"}t.Fatal(err)
        ${"\t"}}' \
          --replace-fail 'r := &LightRenderer{ttyin: inR, escDelay: defaultEscDelay}' \
            'r := &LightRenderer{ttyin: inR, escDelay: defaultEscDelay, buffer: []byte("\x1b[12")}'
      '';
  });

  direnv = prev.direnv.overrideAttrs (oldAttrs: {
    postPatch =
      (oldAttrs.postPatch or "")
      + final.lib.optionalString prev.stdenv.hostPlatform.isDarwin ''
        substituteInPlace test/direnv-test-common.sh \
          --replace-fail 'direnv_eval() {
          eval "$(direnv export "$TARGET_SHELL")"
        }' 'direnv_eval() {
          local direnvDump
          direnvDump=$(mktemp)
          direnv export "$TARGET_SHELL" > "$direnvDump" || true
          source "$direnvDump"
          rm -f "$direnvDump"
        }'

        substituteInPlace GNUmakefile \
          --replace-fail 'zsh ./test/direnv-test.zsh' \
            'zsh -f ./test/direnv-test.zsh'
      '';
  });

  gitstatus = prev.gitstatus.overrideAttrs (oldAttrs: {
    installPhase =
      oldAttrs.installPhase
      + ''
        install -Dm444 gitstatus.prompt.sh -t $out/share/gitstatus/
        install -Dm444 gitstatus.prompt.zsh -t $out/share/gitstatus/
      '';
  });
}
