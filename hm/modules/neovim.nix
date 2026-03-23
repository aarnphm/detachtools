{
  config,
  lib,
  pkgs,
  ...
}:
with lib; {
  options.neovim = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''neovim configuration'';
    };
  };

  config = mkIf config.neovim.enable {
    programs.neovim = {
      enable = true;
      package = pkgs.neovim;
      vimAlias = true;
      withPython3 = true;
      defaultEditor = true;
    };
  };
}
