{
  description = "Anvil contributor and release validation environments";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: import nixpkgs { inherit system; };
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = pkgsFor system;
        in
        {
          deadcode = pkgs.buildGoModule {
            pname = "deadcode";
            version = "0.31.0";
            src = pkgs.fetchFromGitHub {
              owner = "golang";
              repo = "tools";
              rev = "v0.31.0";
              hash = "sha256-6YtMyPY7N4z/uxVGVyk9Ucfrd/HbNSiXC2K2/PJU44A=";
            };
            subPackages = [ "cmd/deadcode" ];
            vendorHash = "sha256-6tMAGBmh5oNE2qK++u7IgIVveXb8bfkNpq6rwVqPvLw=";
          };
        });

      devShells = forAllSystems (system:
        let
          pkgs = pkgsFor system;
          deadcode = self.packages.${system}.deadcode;
          nativeBuildTools = [
            pkgs.gcc
            pkgs.gnumake
            pkgs.node-gyp
            pkgs.pkg-config
            pkgs.python311
          ];
          contributorPackages = nativeBuildTools ++ [
            pkgs.bun
            pkgs.git
            pkgs.nodejs_22
          ];
          releasePackages = contributorPackages ++ [
            pkgs.gitleaks
            pkgs.go
            pkgs.govulncheck
            pkgs.golangci-lint
            pkgs.go-tools
            pkgs.uv
            deadcode
          ];
        in
        {
          default = pkgs.mkShell {
            packages = contributorPackages;
          };

          release = pkgs.mkShell {
            packages = releasePackages;
          };
        });
    };
}
