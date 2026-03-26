{
  stdenv,
  lib,
}:
stdenv.mkDerivation {
  name = "bash-dix";
  src = ./.;
  strictDeps = true;
  installPhase = ''
    mkdir -p $out/share/bash
    cp *.bash $out/share/bash/
  '';
  meta = {
    description = "bash configuration for remote machines";
    maintainers = with lib.maintainers; [aarnphm];
    platforms = lib.platforms.unix;
  };
}
