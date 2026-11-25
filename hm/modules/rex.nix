{
  config,
  lib,
  pkgs,
  ...
}:
with lib; let
  rexBin = "/Applications/Rex.app/Contents/Helpers/Rex Server.rex/Contents/MacOS/rex";

  mkGhosttyTheme = theme:
    concatStringsSep "\n" ([
        "background = ${theme.background}"
        "foreground = ${theme.foreground}"
        "cursor-color = ${theme.cursor}"
        "cursor-text = ${theme.cursorText}"
        "selection-background = ${theme.selectionBackground}"
        "selection-foreground = ${theme.selectionForeground}"
      ]
      ++ imap0 (i: c: "palette = ${toString i}=${c}") theme.palette)
    + "\n";

  themes = {
    "Flexoki Dark" = {
      background = "#100f0f";
      foreground = "#cecdc3";
      cursor = "#cecdc3";
      cursorText = "#100f0f";
      selectionBackground = "#403e3c";
      selectionForeground = "#cecdc3";
      palette = ["#100f0f" "#d14d41" "#879a39" "#d0a215" "#4385be" "#ce5d97" "#3aa99f" "#878580" "#575653" "#af3029" "#66800b" "#ad8301" "#205ea6" "#a02f6f" "#24837b" "#cecdc3"];
    };
    "Flexoki Light" = {
      background = "#fffcf0";
      foreground = "#100f0f";
      cursor = "#100f0f";
      cursorText = "#fffcf0";
      selectionBackground = "#cecdc3";
      selectionForeground = "#100f0f";
      palette = ["#100f0f" "#af3029" "#66800b" "#ad8301" "#205ea6" "#a02f6f" "#24837b" "#6f6e69" "#b7b5ac" "#d14d41" "#879a39" "#d0a215" "#4385be" "#ce5d97" "#3aa99f" "#cecdc3"];
    };
  };

  themeFiles = mapAttrs (name: theme: pkgs.writeText "rex-theme-${replaceStrings [" "] ["-"] name}" (mkGhosttyTheme theme)) themes;
  themeStamp = builtins.hashString "sha256" (concatStringsSep ":" (attrValues (mapAttrs (n: f: "${n}=${f}") themeFiles)));
  themeDir = "${config.xdg.configHome}/rex/themes";
in {
  options.rex = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''Rex.app themes (Flexoki dark and light)'';
    };
  };

  config = mkIf config.rex.enable {
    xdg.configFile = mapAttrs' (name: file: nameValuePair "rex/themes/${name}" {source = file;}) themeFiles;

    # Rex keeps imported themes in its own defaults; importing a name again replaces it in place.
    home.activation.rexThemes = hm.dag.entryAfter ["writeBoundary"] ''
      stamp="${config.xdg.stateHome}/rex/themes.sha256"
      if [ -x "${rexBin}" ] && [ "$(cat "$stamp" 2>/dev/null)" != "${themeStamp}" ]; then
        client="$(/usr/sbin/scutil --get ComputerName)"
        ok=1
        ${concatMapStringsSep "\n" (name: ''
        "${rexBin}" -C "$client" --autostart=false do client.theme.import path="${themeDir}/${name}" >/dev/null 2>&1 || ok=0
      '') (attrNames themes)}
        if [ "$ok" = 1 ]; then
          run mkdir -p "$(dirname "$stamp")"
          run sh -c 'echo "$1" > "$2"' _ "${themeStamp}" "$stamp"
        else
          echo "rex: Rex.app client $client not connected; themes import on the next switch" >&2
        fi
      fi
    '';
  };
}
