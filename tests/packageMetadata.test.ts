import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readText(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

// ---------------------------------------------------------------------------
// 1. package.json metadata
// ---------------------------------------------------------------------------

describe("package.json metadata", () => {
  const pkg = readJson(path.join(PROJECT_ROOT, "package.json")) as Record<string, unknown>;

  it("has scoped name @aliceshimada/mica", () => {
    expect(pkg.name).toBe("@aliceshimada/mica");
  });

  it("has version 1.2.1", () => {
    expect(pkg.version).toBe("1.2.1");
  });

  it("has repository pointing to Alice-Shimada/mica", () => {
    expect(pkg.repository).toEqual({
      type: "git",
      url: "git+https://github.com/Alice-Shimada/mica.git",
    });
  });

  it("has bugs.url pointing to Alice-Shimada/mica issues", () => {
    const bugs = pkg.bugs as Record<string, unknown> | undefined;
    expect(bugs).toBeDefined();
    expect(bugs!.url).toBe("https://github.com/Alice-Shimada/mica/issues");
  });

  it("has homepage pointing to Alice-Shimada/mica readme", () => {
    expect(pkg.homepage).toBe("https://github.com/Alice-Shimada/mica#readme");
  });

  it("has keywords including the five planned terms", () => {
    const keywords = pkg.keywords as string[] | undefined;
    expect(keywords).toBeDefined();
    expect(keywords).toEqual(
      expect.arrayContaining(["mcp", "wolfram", "mathematica", "notebook", "agent"])
    );
  });

  it("has files including dist/src subdirectories, paclet, bilingual READMEs, LICENSE, and scripts/install.js", () => {
    const files = pkg.files as string[] | undefined;
    expect(files).toBeDefined();
    expect(files).toEqual(
      expect.arrayContaining(["dist/src/backend", "dist/src/bun", "dist/src/cli", "dist/src/mcp", "dist/src/runtime", "paclet", "README.md", "README.zh-CN.md", "LICENSE", "scripts/install.js"])
    );
    // legacy dead code must not be included
    expect(files).not.toEqual(expect.arrayContaining(["dist/src"]));
  });
});

// ---------------------------------------------------------------------------
// 2. LICENSE
// ---------------------------------------------------------------------------

describe("LICENSE", () => {
  const licensePath = path.join(PROJECT_ROOT, "LICENSE");

  it("exists", () => {
    expect(existsSync(licensePath)).toBe(true);
  });

  it("contains MIT License text", () => {
    const content = readText(licensePath);
    expect(content).toContain("MIT License");
    expect(content).toContain("Permission is hereby granted");
  });

  it("contains copyright line for MICA / Alice-Shimada", () => {
    const content = readText(licensePath);
    expect(content).toMatch(/Copyright\s+.*\b(Alice-Shimada|MICA)\b/);
  });
});

// ---------------------------------------------------------------------------
// 3. SECURITY.md
// ---------------------------------------------------------------------------

describe("SECURITY.md", () => {
  const securityPath = path.join(PROJECT_ROOT, "SECURITY.md");

  it("exists", () => {
    expect(existsSync(securityPath)).toBe(true);
  });

  it("mentions localhost / 127.0.0.1", () => {
    const content = readText(securityPath);
    expect(content).toMatch(/localhost|127\.0\.0\.1/);
  });

  it("mentions bearer/token auth", () => {
    const content = readText(securityPath);
    expect(content).toMatch(/bearer|token\s*auth/i);
  });

  it("mentions no remote mode", () => {
    const content = readText(securityPath);
    expect(content).toMatch(/no\s+remote/i);
  });

  it("mentions notebook mutation permissions", () => {
    const content = readText(securityPath);
    expect(content).toMatch(/notebook\s+mutation|mutation\s+permission/i);
  });

  it("mentions vulnerability reporting or GitHub issues", () => {
    const content = readText(securityPath);
    expect(content).toMatch(/vulnerability|security\s+(issue|contact|report)/i);
  });
});

// ---------------------------------------------------------------------------
// 4. CHANGELOG.md
// ---------------------------------------------------------------------------

describe("CHANGELOG.md", () => {
  const changelogPath = path.join(PROJECT_ROOT, "CHANGELOG.md");

  it("exists", () => {
    expect(existsSync(changelogPath)).toBe(true);
  });

  it("contains version 0.1.0", () => {
    const content = readText(changelogPath);
    expect(content).toContain("0.1.0");
  });
});

// ---------------------------------------------------------------------------
// 5. CONTRIBUTING.md
// ---------------------------------------------------------------------------

describe("CONTRIBUTING.md", () => {
  const contributingPath = path.join(PROJECT_ROOT, "CONTRIBUTING.md");

  it("exists", () => {
    expect(existsSync(contributingPath)).toBe(true);
  });

  it("mentions tests, typecheck, or build", () => {
    const content = readText(contributingPath);
    expect(content).toMatch(/test|typecheck|build/i);
  });

  it("mentions security issues or reporting", () => {
    const content = readText(contributingPath);
    expect(content).toMatch(/security\s+(issue|report|contact)/i);
  });
});

// ---------------------------------------------------------------------------
// 6. README license badge consistency
// ---------------------------------------------------------------------------

describe("README license badge consistency", () => {
  const readmePath = path.join(PROJECT_ROOT, "README.md");
  const chineseReadmePath = path.join(PROJECT_ROOT, "README.zh-CN.md");

  it("references MIT license", () => {
    const content = readText(readmePath);
    expect(content).toMatch(/MIT/);
  });

  it("references a LICENSE file or MIT license text", () => {
    const content = readText(readmePath);
    // Must reference a local LICENSE file, not just an external URL
    expect(content).toMatch(/LICENSE/);
  });

  it("has a Chinese README with a local English language switch link", () => {
    expect(existsSync(chineseReadmePath)).toBe(true);
    const content = readText(chineseReadmePath);
    expect(content).toContain("[English](README.md)");
    expect(content).toMatch(/简体中文/);
    expect(content).toMatch(/LICENSE/);
  });

  it("has an English README with a local Chinese language switch link", () => {
    const content = readText(readmePath);
    expect(content).toContain("[简体中文](README.zh-CN.md)");
  });

  it("documents npm install -g @aliceshimada/mica in English README", () => {
    const content = readText(readmePath);
    expect(content).toContain("npm install -g @aliceshimada/mica");
  });

  it("documents npm install -g @aliceshimada/mica in Chinese README", () => {
    const content = readText(chineseReadmePath);
    expect(content).toContain("npm install -g @aliceshimada/mica");
  });
});

// ---------------------------------------------------------------------------
// 7. package files list excludes dev-only docs and includes runtime scripts
// ---------------------------------------------------------------------------

describe("package files list (source-level pack check)", () => {
  const pkg = readJson(path.join(PROJECT_ROOT, "package.json")) as Record<string, unknown>;

  it("does not include tests directory", () => {
    const files = pkg.files as string[] | undefined;
    if (!files) return; // skip if files not set (already caught by metadata test)
    expect(files).not.toContain("tests");
    expect(files).not.toContain("dist/tests");
  });

  it("does not include docs/superpowers or Downloads paths", () => {
    const files = pkg.files as string[] | undefined;
    if (!files) return;
    for (const f of files) {
      expect(f).not.toMatch(/^docs\/superpowers/);
      expect(f).not.toMatch(/^Downloads/);
    }
  });

  it("includes scripts/install.js (runtime dependency of CLI)", () => {
    const files = pkg.files as string[] | undefined;
    if (!files) return;
    expect(files).toContain("scripts/install.js");
  });
});
