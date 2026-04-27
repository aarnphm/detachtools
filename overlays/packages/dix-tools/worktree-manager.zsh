#! @shell@

set -euo pipefail

GIT="@git@"

# Extra directories copied from the source repo into freshly created worktrees.
EXTRA_WORKTREE_DIRS=(.claude .cursor)

usage() {
    cat <<'USAGE'
Usage:
  @pname@ --list
  @pname@ --rm <project> <worktree> [-- <git-args>...]
  @pname@ cd <project> <worktree>
  @pname@ sync [-- <git-args>...]
  @pname@ <project> <worktree> [--remote URL] [--base BRANCH] [-- <git-args>...] [command ...]

Arguments after -- are passed directly to the underlying git command.

Environment overrides:
  WORKTREE_BASE_DIR         Base directory containing projects (default: $HOME/workspace)
  WORKTREE_PROJECTS_DIR     Overrides project directory (defaults to WORKTREE_BASE_DIR)
  WORKTREE_WORKTREES_DIR    Overrides worktree storage (default: <projects>/worktrees)
  WORKTREE_BRANCH_PREFIX    Branch prefix when creating new worktrees (default: $USER)
  WORKTREE_REMOTE           Default git remote URL when bootstrapping a missing project
  WORKTREE_BASE_BRANCH      Base branch used when creating new worktrees (default: main)

Existing projects are kept offline by default. Use `@pname@ sync` from inside a
worktree when you want to fetch and rebase.
USAGE
}

projects_dir() {
    if [ -n "${WORKTREE_PROJECTS_DIR:-}" ]; then
        printf '%s\n' "$WORKTREE_PROJECTS_DIR"
    elif [ -n "${WORKTREE_BASE_DIR:-}" ]; then
        printf '%s\n' "$WORKTREE_BASE_DIR"
    else
        printf '%s\n' "$HOME/workspace"
    fi
}

worktrees_dir() {
    if [ -n "${WORKTREE_WORKTREES_DIR:-}" ]; then
        printf '%s\n' "$WORKTREE_WORKTREES_DIR"
    else
        printf '%s/worktrees\n' "$(projects_dir)"
    fi
}

warn() {
    printf 'Warning: %s\n' "$*" >&2
}

list_worktrees() {
    local worktrees="$(worktrees_dir)"
    local found=0

    if [ -d "$worktrees" ]; then
        for project in "$worktrees"/*; do
            [ -d "$project" ] || continue
            found=1
            local project_name
            project_name=$(basename "$project")
            printf '\n[%s]\n' "$project_name"
            for wt in "$project"/*; do
                [ -d "$wt" ] || continue
                printf '  - %s\n' "$(basename "$wt")"
            done
        done
    fi

    if [ "$found" -eq 0 ]; then
        echo "No worktrees found."
    fi
}

remove_worktree() {
    local project="$1"
    local worktree="$2"
    shift 2 || true
    local git_args=("$@")
    local repo_dir="$(projects_dir)/$project"
    local worktrees="$(worktrees_dir)"
    local target="$worktrees/$project/$worktree"

    if [ -z "$project" ] || [ -z "$worktree" ]; then
        echo "Usage: w --rm <project> <worktree> [-- <git-args>...]" >&2
        return 1
    fi

    if [ ! -d "$repo_dir/.git" ]; then
        echo "Project not found: $repo_dir" >&2
        return 1
    fi

    if [ ! -d "$target" ]; then
        echo "Worktree not found: $target" >&2
        return 1
    fi

    (cd "$repo_dir" && "$GIT" worktree remove "${git_args[@]}" "$target")
}

cd_worktree() {
    local project="${1:-}"
    local worktree="${2:-}"

    if [ -z "$project" ] || [ -z "$worktree" ]; then
        echo "Usage: @pname@ cd <project> <worktree>" >&2
        return 1
    fi

    local target="$(worktrees_dir)/$project/$worktree"
    if [ ! -d "$target" ]; then
        echo "Worktree not found: $target" >&2
        return 1
    fi

    printf 'Launching shell in %s\n' "$target"
    cd "$target"
    exec "${SHELL:-/bin/sh}"
}

sync_worktree() {
    local git_args=("$@")
    local base_branch="${WORKTREE_BASE_BRANCH:-main}"
    local worktrees
    worktrees="$(worktrees_dir)"
    local cwd
    cwd="$(pwd)"

    case "$cwd" in
        "$worktrees"/*)
            ;;
        *)
            echo "Not inside a worktree directory ($worktrees)" >&2
            return 1
            ;;
    esac

    local rel="${cwd#"$worktrees"/}"
    local project="${rel%%/*}"
    local repo_dir="$(projects_dir)/$project"

    if [ ! -d "$repo_dir/.git" ]; then
        echo "Project repo not found: $repo_dir" >&2
        return 1
    fi

    echo "Fetching origin/$base_branch..."
    "$GIT" fetch origin "$base_branch" || {
        echo "Failed to fetch origin/$base_branch" >&2
        return 1
    }

    echo "Rebasing onto origin/$base_branch..."
    "$GIT" rebase "origin/$base_branch" --autosquash --ff "${git_args[@]}" || {
        echo "Rebase failed. Resolve conflicts then 'git rebase --continue'" >&2
        return 1
    }
}

resolve_base_ref() {
    local repo_dir="$1"
    local base_branch="$2"

    if "$GIT" -C "$repo_dir" rev-parse --verify --quiet "$base_branch" >/dev/null 2>&1; then
        printf '%s\n' "$base_branch"
        return 0
    fi

    if "$GIT" -C "$repo_dir" show-ref --verify --quiet "refs/remotes/origin/$base_branch"; then
        printf '%s\n' "origin/$base_branch"
        return 0
    fi

    if "$GIT" -C "$repo_dir" rev-parse --verify --quiet HEAD >/dev/null 2>&1; then
        warn "$base_branch not found in $repo_dir; creating new worktrees from HEAD"
        printf '%s\n' HEAD
        return 0
    fi

    echo "Base branch not found: $base_branch" >&2
    return 1
}

create_worktree_if_missing() {
    local repo_dir="$1"
    local target="$2"
    local branch_name="$3"
    local base_ref="$4"
    shift 4 || true
    local git_args=("$@")

    if [ -d "$target" ]; then
        return 0
    fi

    mkdir -p "$(dirname "$target")"

    if "$GIT" -C "$repo_dir" rev-parse --verify --quiet "$branch_name" >/dev/null 2>&1; then
        "$GIT" -C "$repo_dir" worktree add "${git_args[@]}" "$target" "$branch_name"
        return $?
    fi

    if "$GIT" -C "$repo_dir" show-ref --verify --quiet "refs/remotes/origin/$branch_name"; then
        "$GIT" -C "$repo_dir" worktree add --track -b "$branch_name" "${git_args[@]}" "$target" "origin/$branch_name"
        return $?
    fi

    "$GIT" -C "$repo_dir" worktree add -b "$branch_name" "${git_args[@]}" "$target" "$base_ref"
}

copy_extra_directories() {
    local repo_dir="$1"
    local target="$2"
    local dir

    for dir in "${EXTRA_WORKTREE_DIRS[@]}"; do
        local src="$repo_dir/$dir"
        local dest="$target/$dir"

        [ -e "$src" ] || continue
        [ -e "$dest" ] && continue

        cp -a "$src" "$target/" 2>/dev/null ||
        warn "failed to copy $dir from $repo_dir to $target"
    done
}

enter_worktree_or_execute() {
    local target="$1"
    shift || true

    if [ $# -eq 0 ]; then
        printf 'Launching shell in %s\n' "$target"
        cd "$target"
        exec "${SHELL:-/bin/sh}"
    else
        (cd "$target" && "$@")
    fi
}

prepare_repository() {
    local project="$1"
    local remote="$2"
    local remote_explicit="$3"
    local base_branch="$4"

    local base_dir
    base_dir=$(projects_dir)
    local repo_dir="$base_dir/$project"
    mkdir -p "$base_dir"

    if [ ! -d "$repo_dir/.git" ]; then
        if [ -z "$remote" ]; then
            echo "Project $project not found. Provide --remote or set WORKTREE_REMOTE." >&2
            return 1
        fi

        if [ -d "$repo_dir" ] && [ "$(ls -A "$repo_dir" 2>/dev/null)" != "" ]; then
            echo "Directory $repo_dir exists but is not a git repository." >&2
            return 1
        fi

        echo "Cloning $remote into $repo_dir" >&2
        "$GIT" clone "$remote" "$repo_dir" >/dev/null 2>&1 || {
            echo "Failed to clone $remote" >&2
            return 1
        }
    fi

    local current_remote
    current_remote=$("$GIT" -C "$repo_dir" remote get-url origin 2>/dev/null || true)

    if [ "$remote_explicit" -eq 1 ] && [ -n "$remote" ]; then
        if [ -z "$current_remote" ]; then
            "$GIT" -C "$repo_dir" remote add origin "$remote"
        elif [ "$current_remote" != "$remote" ]; then
            echo "Updating origin remote for $project" >&2
            "$GIT" -C "$repo_dir" remote set-url origin "$remote"
        fi
    fi

    resolve_base_ref "$repo_dir" "$base_branch"
}

main() {
    if [ $# -eq 0 ]; then
        usage
        exit 1
    fi

    case "$1" in
        --help | -h)
            usage
            exit 0
            ;;
        --list)
            list_worktrees
            exit 0
            ;;
        --rm)
            shift
            if [ $# -lt 2 ]; then
                echo "Usage: w --rm <project> <worktree> [-- <git-args>...]" >&2
                exit 1
            fi
            local rm_project="$1" rm_worktree="$2"
            shift 2
            local rm_git_args=()
            if [ "${1:-}" = "--" ]; then
                shift
                rm_git_args=("$@")
            fi
            remove_worktree "$rm_project" "$rm_worktree" "${rm_git_args[@]}"
            exit $?
            ;;
        cd)
            shift
            cd_worktree "${1:-}" "${2:-}"
            exit $?
            ;;
        sync)
            shift
            local sync_git_args=()
            if [ "${1:-}" = "--" ]; then
                shift
                sync_git_args=("$@")
            fi
            sync_worktree "${sync_git_args[@]}"
            exit $?
            ;;
    esac

    if [ $# -lt 2 ]; then
        usage >&2
        exit 1
    fi

    local project="$1"
    local worktree="$2"
    shift 2

    local remote="${WORKTREE_REMOTE:-}"
    local remote_explicit=0
    local base_branch="${WORKTREE_BASE_BRANCH:-main}"
    local command=()
    local git_args=()

    while [ $# -gt 0 ]; do
        case "$1" in
            --remote)
                shift || {
                    echo "Error: --remote requires a value" >&2
                    exit 1
                }
                remote="$1"
                remote_explicit=1
                ;;
            --remote=*)
                remote="${1#--remote=}"
                remote_explicit=1
                ;;
            --base)
                shift || {
                    echo "Error: --base requires a value" >&2
                    exit 1
                }
                base_branch="$1"
                ;;
            --base=*)
                base_branch="${1#--base=}"
                ;;
            --)
                shift
                git_args=("$@")
                set --
                break
                ;;
            --help | -h)
                usage
                exit 0
                ;;
            --list | --rm)
                echo "Error: $1 must be the first argument" >&2
                exit 1
                ;;
            *)
                command=("$@")
                break
                ;;
        esac
        shift
    done

    local repo_dir="$(projects_dir)/$project"
    local worktree_root="$(worktrees_dir)/$project"
    local target="$worktree_root/$worktree"
    local branch_prefix="${WORKTREE_BRANCH_PREFIX:-${USER:-feat}}"
    local branch_name="$branch_prefix/$worktree"
    local created_target=0

    if [ ! -d "$target" ]; then
        created_target=1
    fi

    local base_ref
    base_ref=$(prepare_repository "$project" "$remote" "$remote_explicit" "$base_branch") || exit 1

    mkdir -p "$worktree_root"

    if ! create_worktree_if_missing "$repo_dir" "$target" "$branch_name" "$base_ref" "${git_args[@]}"; then
        echo "Failed to create worktree at $target" >&2
        exit 1
    fi

    if [ ! -d "$target" ]; then
        echo "Worktree directory missing: $target" >&2
        exit 1
    fi

    if [ "$created_target" -eq 1 ]; then
        copy_extra_directories "$repo_dir" "$target"
    fi

    if [ ${#command[@]} -eq 0 ]; then
        enter_worktree_or_execute "$target"
    else
        enter_worktree_or_execute "$target" "${command[@]}"
    fi
}

main "$@"
