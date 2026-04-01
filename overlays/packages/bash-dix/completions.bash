if [[ $- =~ i ]]; then

__dix_source_git_completion() {
  local gitExe gitRoot candidate

  gitExe=$(type -P git 2>/dev/null) || return 0
  gitExe=$(realpath "$gitExe" 2>/dev/null || printf '%s' "$gitExe")
  gitRoot=${gitExe%/bin/git}

  for candidate in \
    "$gitRoot/share/bash-completion/completions/git" \
    "$gitRoot/share/git/contrib/completion/git-completion.bash"
  do
    if [[ -r "$candidate" ]]; then
      source "$candidate"
      return 0
    fi
  done
}

__dix_register_git_completion() {
  declare -F __git_complete >/dev/null || return 0

  __git_complete g __git_main

  while (($# >= 2)); do
    __git_complete "$1" "$2"
    shift 2
  done
}

__dix_source_git_completion
__dix_register_git_completion \
  ga git_add \
  gaa git_add \
  gb git_branch \
  gbd git_branch \
  gck git_checkout \
  gckb git_checkout \
  gcm git_commit \
  gcma git_commit \
  gcman git_commit \
  gcmm git_commit \
  gcp git_cherry_pick \
  gcpa git_cherry_pick \
  gcpc git_cherry_pick \
  gdf git_diff \
  gfom git_fetch \
  gfum git_fetch \
  gp git_pull \
  gpu git_push \
  gpuf git_push \
  gra git_rebase \
  grb git_rebase \
  grc git_rebase \
  grfh git_rebase \
  grifh git_rebase \
  grpo git_remote \
  grpu git_remote \
  grst git_restore \
  grsts git_restore \
  gsm git_status \
  gsi git_status \
  gst git_status \
  gsp git_stash \
  gsts git_stash \
  gsw git_switch

unset -f __dix_source_git_completion
unset -f __dix_register_git_completion

fi
