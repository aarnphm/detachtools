{self}: final: prev: {
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
