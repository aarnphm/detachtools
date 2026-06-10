{self}: final: prev: {
  container = prev.container.overrideAttrs (_oldAttrs: let
    version = "1.0.0";
  in {
    inherit version;
    src = final.fetchurl {
      url = "https://github.com/apple/container/releases/download/${version}/container-${version}-installer-signed.pkg";
      hash = "sha256-E/RfJtqUw1Sty+/h6PdjHn8SbpPF1N1qWlOKpmtPR50=";
    };
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
