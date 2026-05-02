zmodload -i zsh/complist

# use completions cache
zstyle ':completion:*' use-cache on
zstyle ':completion:*' cache-path "$XDG_CACHE_HOME/zsh/.zcompcache"
# ls color goes hard
zstyle ':completion:*' list-colors ''
# enable hidden files on completion
zstyle ':completion:*' special-dirs true
# disable menu for fzf-tab
zstyle ':completion:*' menu no
# hide parents
zstyle ':completion:*' ignored-patterns '.|..|.DS_Store|**/.|**/..|**/.DS_Store|**/.git|__pycache__|**/__pycache__|.mypy_cache|.ipynb_checkpoints|.ruff_cache'
# hide `..` and `.` from file menu
zstyle ':completion:*' ignore-parents 'parent pwd directory'
# details completions menu formatting and messages
zstyle ':completion:*:matches' group 'yes'
zstyle ':completion:*' matcher-list '' 'm:{a-z}={A-Z}' 'm:{a-zA-Z}={A-Za-z}' 'r:|[._-]=* r:|=* l:|=*'
zstyle ':completion:*:descriptions' format '[%d]'

_dixCompletionDir="${${(%):-%x}:h}"
_dixSiteFunctionsDir="$_dixCompletionDir/site-functions"

if [[ -d "$_dixSiteFunctionsDir" && ${fpath[(Ie)$_dixSiteFunctionsDir]} -eq 0 ]]; then
  fpath=("$_dixSiteFunctionsDir" "${fpath[@]}")
fi

zstyle ':fzf-tab:*' switch-group '[' ']'
zstyle ':fzf-tab:*' fzf-bindings \
  "ctrl-f:execute({_FTB_INIT_}source ${(q)_dixCompletionDir}/fzf-tab-edit.zsh)+abort"

# complete `ls` / `cat` / etc
zstyle ':fzf-tab:complete:(\\|*/|)(ls|gls|bat|eza|cat|cd|rm|cp|mv|ln|nano|nvim|vim|open|tree|source):*' \
  fzf-preview \
  '_fzf_complete_realpath "$realpath"'

# complete `make`
zstyle ':fzf-tab:complete:(\\|*/|)make:*' fzf-preview \
  'case "$group" in
  "[make target]")
    make -n "$word" | _fzf_complete_realpath
    ;;
  "[make variable]")
    make -pq | rg "^$word =" | _fzf_complete_realpath
    ;;
  "[file]")
    _fzf_complete_realpath "$realpath"
    ;;
  esac'

# complete `killall`
zstyle ':completion:*:*:killall:*:*' command 'ps -u "$USERNAME" -o comm'
zstyle ':fzf-tab:complete:(\\|*/|)killall:*' fzf-preview 'ps aux | rg "$word" | _fzf_complete_realpath'

# zoxide
zstyle ':fzf-tab:complete:(\\|*/|)(j|__zoxide_z):*' fzf-preview '_fzf_complete_realpath "$word"'

# ignores unavailable commands
zstyle ':completion:*:functions' ignored-patterns '(_*|pre(cmd|exec)|prompt_*)'

zstyle ':completion:*:*:kill:*:processes' list-colors '=(#b) #([0-9]#) ([0-9a-z-]#)*=01;34=0=01'
zstyle ':completion:*:*:*:*:processes' command "ps -u `whoami` -o pid,user,comm -w -w"

zstyle ':completion:*' users off

# ... unless we really want to.
zstyle '*' single-ignored show

zstyle -e ':completion:*:(ssh|scp|sftp|rsh|rsync):hosts' hosts 'reply=(${=${${(f)"$(cat {/etc/ssh_,~/.ssh/known_}hosts(|2)(N) /dev/null)"}%%[# ]*}//,/ })'

_dix_register_completions() {
  (( $+functions[compdef] )) || return 1

  autoload -Uz _claude _cl
  compdef _claude claude
  compdef _cl cl
}

if ! _dix_register_completions; then
  autoload -Uz add-zsh-hook

  _dix_register_completions_once() {
    _dix_register_completions || return 0
    add-zsh-hook -d precmd _dix_register_completions_once 2> /dev/null || true
  }

  add-zsh-hook precmd _dix_register_completions_once 2> /dev/null || true
fi

unset _dixCompletionDir _dixSiteFunctionsDir
