import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const service = "io.github.sirbughunter.agenticwear.bridge";

export async function setKeychainSecret(account: string, secret: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("The v0.1 bridge currently requires macOS Keychain");
  if (secret.length < 20) throw new Error("Refusing to store a short secret");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "expect",
      ["-c", keychainWriteProgram],
      {
        env: {
          ...process.env,
          AGENTIC_WEAR_KEYCHAIN_ACCOUNT: account,
          AGENTIC_WEAR_KEYCHAIN_SERVICE: service,
        },
        stdio: ["pipe", "ignore", "ignore"],
      },
    );
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Could not store the bridge secret in Keychain (${code ?? "unknown"})`));
    });
    child.stdin.end(`${secret}\n`);
  });
}

export async function readKeychainSecret(account: string): Promise<string> {
  if (process.platform !== "darwin") throw new Error("The v0.1 bridge currently requires macOS Keychain");
  const { stdout } = await execFileAsync(
    "security",
    ["find-generic-password", "-a", account, "-s", service, "-w"],
    { encoding: "utf8", maxBuffer: 64 * 1_024 },
  );
  const value = stdout.trim();
  if (value.length < 20) throw new Error("The bridge secret in Keychain is invalid");
  return value;
}

export async function deleteKeychainSecret(account: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("The v0.1 bridge currently requires macOS Keychain");
  await execFileAsync(
    "security",
    ["delete-generic-password", "-a", account, "-s", service],
    { encoding: "utf8", maxBuffer: 64 * 1_024 },
  );
}

export const privateKeyAccount = (pairId: string): string => `${pairId}:ecdh-private-key`;
export const bridgeCredentialAccount = (pairId: string): string => `${pairId}:relay-credential`;
export const pairingAuthenticatorAccount = (pairId: string): string => `${pairId}:pairing-authenticator-v2`;
export const relayBootstrapAccount = "relay-bootstrap-v1";

const keychainWriteProgram = [
  "log_user 0",
  "set timeout 15",
  "gets stdin secret",
  "set account $env(AGENTIC_WEAR_KEYCHAIN_ACCOUNT)",
  "set service $env(AGENTIC_WEAR_KEYCHAIN_SERVICE)",
  "spawn security add-generic-password -U -a $account -s $service -l {Agentic Wear bridge} -w",
  "expect -re {password.*:}",
  "send -- \"$secret\\r\"",
  "expect -re {retype password.*:}",
  "send -- \"$secret\\r\"",
  "expect eof",
  "set result [wait]",
  "exit [lindex $result 3]",
].join("; ");
