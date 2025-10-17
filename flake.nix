{
  description = "appl-mbp16 and adjacents setup for Aaron";

  inputs = {
    # system
    nixpkgs.url = "github:NixOS/nixpkgs/master";
    nix-darwin = {
      url = "github:LnL7/nix-darwin/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    home-manager = {
      url = "github:nix-community/home-manager/master";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    determinate = {
      url = "https://flakehub.com/f/DeterminateSystems/determinate/*";
    };
    # utilities
    git-hooks = {
      url = "github:cachix/git-hooks.nix/master";
      inputs = {
        nixpkgs.follows = "nixpkgs";
      };
    };

    # packages
    nix-homebrew = {
      url = "github:zhaofengli-wip/nix-homebrew";
    };
    neovim = {
      url = "github:nix-community/neovim-nightly-overlay";
      inputs = {
        nixpkgs.follows = "nixpkgs";
        git-hooks.follows = "git-hooks";
      };
    };
  };

  # meta function: https://github.com/NixOS/nixpkgs/blob/master/lib/meta.nix
  outputs = {
    self,
    determinate,
    nix-darwin,
    nixpkgs,
    home-manager,
    git-hooks,
    neovim,
    ...
  } @ inputs: let
    overlays =
      # additional packages
      [
        neovim.overlays.default
        nix-darwin.overlays.default
      ]
      # custom overlays
      ++ (import ./overlays {inherit self;});
    forPackages = system:
      import nixpkgs {
        inherit system overlays;
        config = {
          allowUnfree = true;
          allowBroken = true;
          allowUnsupportedSystem = true;
        };
      };
  in
    builtins.foldl' nixpkgs.lib.recursiveUpdate {
      # NOTE: This will change some of your default packages, so proceed with CAUTION.
      overlays.default = nixpkgs.lib.composeManyExtensions overlays;

      darwinConfigurations = builtins.listToAttrs (builtins.map (computerName: let
        user = "aarnphm";
      in {
        name = computerName;
        value = nix-darwin.lib.darwinSystem rec {
          system = "aarch64-darwin";
          pkgs = forPackages system;
          specialArgs = {inherit self inputs pkgs user computerName;};
          modules = [
            home-manager.darwinModules.home-manager
            {
              home-manager = {
                useGlobalPkgs = true;
                useUserPackages = true;
                users."${user}".imports = [./hm];
                backupFileExtension = "backup-from-hm";
                extraSpecialArgs = specialArgs;
                verbose = true;
              };
            }
            inputs.nix-homebrew.darwinModules.nix-homebrew
            {
              nix-homebrew = {
                inherit user;
                enable = true;
                enableRosetta = true;
                autoMigrate = true;
                extraEnv = {
                  HOMEBREW_NO_ANALYTICS = "1";
                };
              };
            }
            ./darwin
          ];
        };
      }) ["appl-mbp16" "bentoml"]);

      homeConfigurations = builtins.listToAttrs (builtins.map (
        user: {
          name = user;
          value = home-manager.lib.homeManagerConfiguration rec {
            pkgs = forPackages "x86_64-linux";
            extraSpecialArgs = {inherit self inputs pkgs user;};
            modules = [./hm];
          };
        }
      ) ["aarnphm" "paperspace" "ubuntu" "root"]);
    } (
      builtins.map (
        system: let
          pkgs = forPackages system;
          mkApp = {
            drv,
            name ? drv.pname or drv.name,
            exePath ? drv.passthru.exePath or "/bin/${name}",
          }: {
            type = "app";
            program = "${drv}${exePath}";
          };
        in {
          formatter.${system} = pkgs.alejandra;

          apps.${system} = builtins.listToAttrs (
            builtins.map (
              name: {
                inherit name;
                value =
                  mkApp {drv = pkgs.${name};}
                  // {
                    meta = {
                      mainProgram = name;
                      description = "tooling system, with ${name}";
                    };
                  };
              }
            ) [
              "lambda"
              "aws-credentials"
              "bootstrap"
            ]
          );

          packages.${system} = with pkgs; {
            inherit lambda aws-credentials gvim;
          };

          checks.${system} = {
            pre-commit-check = git-hooks.lib.${system}.run {
              src = builtins.path {
                path = ./.;
                name = "source";
              };
              hooks = {
                alejandra.enable = true;
                statix.enable = true;
              };
            };
          };

          devShells.${system} = {
            default = pkgs.mkShell {
              inherit (self.checks.${system}.pre-commit-check) shellHook;
              buildInputs = self.checks.${system}.pre-commit-check.enabledPackages;
            };
          };
        }
      ) ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"]
    );
}
