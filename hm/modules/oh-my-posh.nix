{
  config,
  lib,
  ...
}:
with lib; {
  options.oh-my-posh = {
    enable = mkOption {
      type = types.bool;
      default = false;
      description = mdDoc ''oh-my-posh configuration'';
    };
  };

  config = mkIf config.oh-my-posh.enable {
    programs = {
      oh-my-posh = {
        enable = true;
        enableBashIntegration = true;
        enableZshIntegration = true;
        enableFishIntegration = false;
        enableNushellIntegration = false;
        settings = {
          version = 3;
          final_space = true;
          transient_prompt = {
            background = "transparent";
            template = "➜ ";
            foreground_templates = [
              "{{if gt .Code 0}}red{{end}}"
              "{{if eq .Code 0}}green{{end}}"
            ];
          };
          blocks = [
            {
              alignment = "left";
              type = "prompt";
              segments = [
                {
                  foreground = "lightBlue";
                  foreground_templates = ["{{ if .Root }}lightRed{{ end }}"];
                  style = "plain";
                  template = ''<{{ if .Root }}lightBlue{{ else }}green{{ end }}>┌─(</>{{ .UserName }}{{ if .Root }}💀{{ else }}@{{ end }}{{ .HostName }}<{{ if .Root }}lightBlue{{ else }}green{{ end }}>)</>'';
                  type = "session";
                  properties.display_host = true;
                }
                {
                  foreground = "cyan";
                  foreground_templates = [
                    ''{{ if eq .Env.DIX_VI_MODE "N" }}red{{ end }}''
                    ''{{ if eq .Env.DIX_VI_MODE "V" }}magenta{{ end }}''
                    ''{{ if eq .Env.DIX_VI_MODE "I" }}cyan{{ end }}''
                  ];
                  style = "plain";
                  template = ''{{ if .Env.DIX_VI_MODE }}<{{ if .Root }}lightBlue{{ else }}green{{ end }}>-[</>{{ .Env.DIX_VI_MODE }}<{{ if .Root }}lightBlue{{ else }}green{{ end }}>]</>{{ end }}'';
                  type = "text";
                }
                {
                  foreground = "yellow";
                  style = "plain";
                  template = ''<{{ if .Root }}lightBlue{{ else }}green{{ end }}>-[</> {{ if .Error }}{{ .Error }}{{ else }}{{ .Full }}{{ end }}<{{ if .Root }}lightBlue{{ else }}green{{ end }}>]</>'';
                  type = "python";
                  properties = {
                    fetch_version = true;
                    fetch_virtual_env = true;
                  };
                }
                {
                  foreground = "magenta";
                  style = "plain";
                  template = ''<{{ if .Root }}lightBlue{{ else }}green{{ end }}>-[</> {{ if eq .Type "unknown" }}{{ else }}nix-{{ .Type }}{{ end }}<{{ if .Root }}lightBlue{{ else }}green{{ end }}>]</>'';
                  type = "nix-shell";
                }
                {
                  foreground = "lightWhite";
                  style = "plain";
                  template = ''<{{ if .Root }}lightBlue{{ else }}green{{ end }}>-[</>{{ .Path }}<{{ if .Root }}lightBlue{{ else }}green{{ end }}>]</>'';
                  type = "path";
                  properties = {
                    folder_separator_icon = "<#c0c0c0>/</>";
                    style = "unique";
                  };
                }
                {
                  foreground = "white";
                  style = "plain";
                  template = ''<{{ if .Root }}lightBlue{{ else }}green{{ end }}>-[</>{{ if .IsWorkTree }}wt {{ end }}{{ .HEAD }}{{if .BranchStatus }} {{ .BranchStatus }}{{ end }}{{ if .Working.Changed }} {{ .Working.String }}{{ end }}{{ if and (.Working.Changed) (.Staging.Changed) }} |{{ end }}{{ if .Staging.Changed }} {{ .Staging.String }}{{ end }}{{ if gt .StashCount 0 }}  {{ .StashCount }}{{ end }}<{{ if .Root }}lightBlue{{ else }}green{{ end }}>]</>'';
                  type = "git";
                  properties = {
                    branch_icon = " ";
                    fetch_status = true;
                    fetch_stash_count = true;
                    fetch_upstream_icon = true;
                    fetch_bare_info = true;
                  };
                }
              ];
            }
            {
              alignment = "left";
              newline = true;
              type = "prompt";
              segments = [
                {
                  foreground_templates = [
                    "{{if gt .Code 0}}red{{end}}"
                    "{{if eq .Code 0}}lightBlue{{end}}"
                  ];
                  style = "plain";
                  template = ''<{{ if .Root }}lightBlue{{ else }}green{{ end }}>└</> {{ if .Root }}<lightRed>#</>{{ else }}~{{ end }}'';
                  type = "text";
                }
              ];
            }
          ];
        };
      };
    };
  };
}
