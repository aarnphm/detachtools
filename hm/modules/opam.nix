{
  config,
  lib,
  ...
}:
with lib; {
  options.opam = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''OPAM configuration'';
    };
  };

  config = mkIf config.opam.enable {
    programs = {
      opam = {
        enable = true;
        enableZshIntegration = true;
        enableBashIntegration = true;
      };
    };
  };
}
