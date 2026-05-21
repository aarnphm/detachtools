path() {
  if [[ -n "$PATH" ]]; then
    echo "$PATH" | tr ':' '\n'
  else
    echo "PATH unset"
  fi
}

cl() {
  local model="opus[1m]"

  if (($# > 0)); then
    if [[ "$1" == "--" ]]; then
      shift
    else
      model="$1"
      shift
      if (($# > 0)); then
        if [[ "$1" != "--" ]]; then
          printf 'usage: cl [optional_model_id] -- [claude args]\n' >&2
          return 2
        fi
        shift
      fi
    fi
  fi

  command claude \
    --allow-dangerously-skip-permissions \
    --model "$model" \
    --chrome \
    --effort max \
    "$@"
}

where-is-program() {
  readlink -f $(which "$@")
}

get-derivation() {
  nix-store --query --deriver $(readlink -f $(which "$@"))
}

__exec_command_with_tmux() {
  local cmd="$@"
  if [[ "$(ps -p $(ps -p $$ -o ppid=) -o comm= 2>/dev/null)" =~ tmux ]]; then
    if [[ $(tmux show-window-options -v automatic-rename) != "off" ]]; then
      local title=$(echo "$cmd" | cut -d ' ' -f 2- | tr ' ' '\n' | grep -v '^-' | sed '/^$/d' | tail -n 1)
      if [ -n "$title" ]; then
        tmux rename-window -- "$title"
      else
        tmux rename-window -- "$cmd"
      fi
      trap 'tmux set-window-option automatic-rename on 1>/dev/null' 2
      eval command "$cmd"
      local ret="$?"
      tmux set-window-option automatic-rename on 1>/dev/null
      return $ret
    fi
  fi
  eval command "$cmd"
}

ssh() {
  local args=$(printf ' %q' "$@")
  local ppid=$(ps -p $$ -o ppid= 2>/dev/null | tr -d ' ')
  if [[ "$@" =~ .*BatchMode=yes.*ls.*-d1FL.* ]]; then
    command ssh "$args"
    return
  fi

  __exec_command_with_tmux "ssh $args"
}

nebius-vm() {
  local NAME="$1"
  local USER="${2:-$USER}"

  local IP
  IP=$(jq -r --arg name "$NAME" '
      .items[]
      | select(.metadata.id == $name)
      | .status.network_interfaces[0].public_ip_address.address
      | split("/")
      | .[0]
  ' -)

  if [[ -z "$IP" || "$IP" == "null" ]]; then
      printf "No public IP found for \"%s\"\n" "$NAME" >&2
      return 1
  fi

  printf "%s@%s" "$USER" "$IP"
}

comment() {
  sed -i "$1"' s/^/#/' "$2"
}

ltrim() {
  local input
  input=$(cat)
  printf "%s" "$(expr "$input" : "^[[:space:]]*\(.*[^[:space:]]\)")"
}

rtrim() {
  local input
  input=$(cat)
  printf "%s" "$(expr "$input" : "^\(.*[^[:space:]]\)[[:space:]]*$")"
}

trim() {
  local input
  input=$(cat)
  printf "%s" "$(echo "$input" | ltrim | rtrim)"
}

trim_whitespace() {
  local input
  input=$(cat)
  echo "$input" | tr -d ' '
}

timeshell() {
  for i in $(seq 1 10); do time bash -c -i exit; done
}

## docker ##
dockerclean() {
  docker rmi -f $(docker images -a | grep "^<none>" | awk '{print $3}') 2>/dev/null
  docker rmi -f $(docker ps -a -f status=exited -q) 2>/dev/null
}

dockerrmi() {
  docker rmi -f $(docker images --filter=reference="$1" -q) 2>/dev/null
}

drm() {
  local cid
  cid=$(docker ps -a | sed 1d | fzf -q "$1" | awk '{print $1}')

  [ -n "$cid" ] && docker rm "$cid"
}

ds() {
  local cid
  cid=$(docker ps | sed 1d | fzf -q "$1" | awk '{print $1}')

  [ -n "$cid" ] && docker stop "$cid"
}

mkd() {
  mkdir -p "$@" && cd "$_"
}

listen() {
  sudo lsof -iTCP:"$@" -sTCP:LISTEN
}

fs() {
  if du -b /dev/null >/dev/null 2>&1; then
    local arg=-sbh
  else
    local arg=-sh
  fi
  if [[ -n "$@" ]]; then
    du $arg -- "$@"
  else
    du $arg .[^.]* ./*
  fi
}

venv() {
  name="${1:-.venv}"
  if [[ ! -d "$name" ]]; then
    uv venv "${PWD}/$name"
    source "$name/bin/activate"
  else
    source "$name/bin/activate"
  fi

  uv pip install pylatexenc mypy jupytext plotly pnglatex pyperclip jupyter-client pynvim jupyterlab-vim
}

if type workon >/dev/null 2>&1; then
  VENV_WRAPPER=true
else
  VENV_WRAPPER=false
fi

_venv_auto_activate() {
  local venvPath
  local venvWrapperActivate
  local venvName
  local currentVenv="${VIRTUAL_ENV-}"
  local projectDir="${PROJECT_DIR-}"
  local debugFlag="${DEBUG-}"
  local venvWrapper="${VENV_WRAPPER-false}"

  if [[ -n "$currentVenv" ]]; then
    if [[ -n "$projectDir" && "$PWD" != "$projectDir"* ]]; then
      [[ -n "$debugFlag" ]] && echo -e "\n\e[1;33mDeactivating venv...\e[0m"
      deactivate
      unset PROJECT_DIR
    fi
    return
  fi

  if [[ -e ".venv" ]]; then
    if [[ -L ".venv" ]]; then
      venvPath="$(readlink .venv)"
      venvWrapperActivate=false
    elif [[ -d ".venv" ]]; then
      venvPath="$(pwd -P)/.venv"
      venvWrapperActivate=false
    elif [[ -f ".venv" && "$venvWrapper" == "true" && -n "${WORKON_HOME-}" ]]; then
      venvPath="$WORKON_HOME/$(cat .venv)"
      venvWrapperActivate=true
    else
      return
    fi

    if [[ "$currentVenv" != "$venvPath" ]]; then
      [[ -n "$debugFlag" ]] && echo -e "\n\e[1;33mActivating venv...\e[0m"
      if $venvWrapperActivate; then
        venvName="$(basename "$venvPath")"
        workon "$venvName"
      else
        venvName="$(basename "$(pwd)")"
        VIRTUAL_ENV_DISABLE_PROMPT=1
        source .venv/bin/activate
      fi
      PROJECT_DIR="$PWD"
    fi
  fi
}

__dix_find_node_bin() {
  local dir="$PWD"
  local nodeBin

  while true; do
    nodeBin="$dir/node_modules/.bin"
    if [[ -d "$nodeBin" ]]; then
      printf "%s\n" "$nodeBin"
      return 0
    fi

    [[ "$dir" == "/" ]] && return 1
    dir="${dir%/*}"
    [[ -z "$dir" ]] && dir="/"
  done
}

__dix_path_has() {
  local entry
  local needle="$1"
  local oldIFS="$IFS"

  IFS=:
  for entry in $PATH; do
    if [[ "$entry" == "$needle" ]]; then
      IFS="$oldIFS"
      return 0
    fi
  done
  IFS="$oldIFS"

  return 1
}

__dix_path_without() {
  local entry
  local newPath=""
  local oldIFS="$IFS"
  local removePath="$1"
  local pathEntries=()

  IFS=:
  read -r -a pathEntries <<< "$PATH"
  IFS="$oldIFS"

  for entry in "${pathEntries[@]}"; do
    [[ "$entry" == "$removePath" ]] && continue
    newPath="${newPath:+$newPath:}$entry"
  done

  PATH="$newPath"
  export PATH
}

__dix_auto_node_bin() {
  local previousNodeBin="${DIX_NODE_BIN_DIR-}"
  local nodeBin

  if [[ -n "$previousNodeBin" ]]; then
    __dix_path_without "$previousNodeBin"
    unset DIX_NODE_BIN_DIR
  fi

  nodeBin="$(__dix_find_node_bin)" || return 0
  __dix_path_has "$nodeBin" && return 0

  PATH="$nodeBin${PATH:+:$PATH}"
  export DIX_NODE_BIN_DIR="$nodeBin"
  export PATH
}

__dix_prompt_command() {
  local exit_code=$?
  history -a
  _venv_auto_activate
  __dix_auto_node_bin
  return $exit_code
}
PROMPT_COMMAND="${PROMPT_COMMAND:+$PROMPT_COMMAND;}__dix_prompt_command"

set_poshcontext() {
  export DIX_VI_MODE=I
}

show_keymaps() {
  local selected_command
  selected_command=$(bind -P | grep -v '^#' | fzf --preview 'echo {}' --preview-window up:50% --bind 'enter:execute(echo {1})+accept')

  if [[ -n $selected_command ]]; then
    eval "$selected_command"
  fi
}
