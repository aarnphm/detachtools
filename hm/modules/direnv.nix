{
  config,
  lib,
  ...
}:
with lib; {
  options.direnv = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''direnv configuration'';
    };
  };

  config = mkIf config.direnv.enable {
    programs.direnv = {
      enable = true;
      enableBashIntegration = true;
      enableFishIntegration = false;
      enableZshIntegration = true;
      nix-direnv.enable = true;
      config = {
        hide_env_diff = true;
        global = {
          load_dotenv = true;
          strict_env = true;
        };
      };
    };
  };
}
