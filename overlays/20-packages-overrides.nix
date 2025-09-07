{self}: final: prev: {
  gitstatus = prev.gitstatus.overrideAttrs (oldAttrs: {
    installPhase =
      oldAttrs.installPhase
      + ''
        install -Dm444 gitstatus.prompt.sh -t $out/share/gitstatus/
        install -Dm444 gitstatus.prompt.zsh -t $out/share/gitstatus/
      '';
  });
}
