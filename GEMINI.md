# Dix

This repository contains the configuration for a development environment managed by [Nix](https://nixos.org/). It uses [nix-darwin](https://github.com/LnL7/nix-darwin) to manage macOS systems and [home-manager](https://github.com/nix-community/home-manager) to manage user environments across both macOS and Linux.

## Project Overview

The primary goal of this project is to provide a reproducible and consistent development environment across multiple machines. This is achieved by declaratively managing system configurations, software packages, and user-specific settings using the Nix language.

### Key Technologies

*   **[Nix](https://nixos.org/):** A powerful package manager and build system that makes it possible to create reproducible and declarative configurations.
*   **[nix-darwin](https://github.com/LnL7/nix-darwin):** A module system for managing macOS systems using Nix.
*   **[home-manager](https://github.com/nix-community/home-manager):** A tool for managing a user's environment, including packages, dotfiles, and services.
*   **[Flakes](https://nixos.wiki/wiki/Flakes):** A new feature in Nix that improves reproducibility and composability.

### Architecture

The repository is structured as follows:

*   `flake.nix`: The main entry point for the Nix configuration. It defines the project's inputs (dependencies) and outputs (packages, configurations, etc.).
*   `darwin/`: Contains the `nix-darwin` configuration for macOS systems.
*   `hm/`: Contains the `home-manager` configuration for user environments.
*   `overlays/`: Contains custom packages and modifications to existing packages.

## Building and Running

To apply the configuration, you can use the `nix` command-line tool.

### Bootstrap

To bootstrap a new machine, you can use the `bootstrap` script. This will install Nix and apply the appropriate configuration for your system.

**macOS:**

```bash
nix run github:aarnphm/dix#bootstrap -- darwin
```

**Ubuntu:**

```bash
nix run github:aarnphm/dix#bootstrap -- ubuntu
```

### Applying Changes

To apply changes to an existing configuration, you can use the `nix run` command with the appropriate target.

**macOS:**

```bash
nix run nix-darwin -- switch --flake .#<hostname>
```

**Linux:**

```bash
nix run home-manager -- switch --flake .#<username>
```

## Development Conventions

### Code Style

This project uses [alejandra](https://github.com/kamadorueda/alejandra) to format Nix code. You can format the code by running:

```bash
nix fmt
```

### Testing

This project uses `pre-commit-check` to run checks before committing code. The checks are defined in `flake.nix` and include `alejandra` and `statix`.
