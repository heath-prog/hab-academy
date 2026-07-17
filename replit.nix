{ pkgs }: {
  deps = [
    pkgs.nodejs_20
    pkgs.python3   # required to build better-sqlite3 native module
    pkgs.gnumake
    pkgs.gcc
  ];
}
