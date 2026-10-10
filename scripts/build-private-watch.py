#!/usr/bin/env python3
"""Build, test and lint a signed private Agentic Wear watch release from this repository.

Runs the watch unit tests, the signed release assembly and release lint in place. It never
publishes; deliver the APK separately with bridge/dist/publish-private-update.js after review.
The signing password is read from the macOS Keychain at run time and is never printed or stored.
"""
from pathlib import Path
import argparse, os, subprocess, sys

parser = argparse.ArgumentParser()
parser.add_argument('--version-code', type=int, required=True)
parser.add_argument('--version-name', required=True)
args = parser.parse_args()
assert args.version_code > 0 and len(args.version_name) <= 40

repo = Path(__file__).resolve().parent.parent
key = Path.home() / 'Library/Application Support/Agentic Wear/release.jks'
if not key.is_file():
    sys.exit('Existing release identity is unavailable; no new signing identity created.')
unlocked = subprocess.run(['/usr/bin/security', 'find-generic-password', '-w', '-s',
    'io.github.sirbughunter.agenticwear.release-signing', '-a', 'release-key'], capture_output=True)
if unlocked.returncode:
    sys.exit('Existing release identity could not be unlocked. No credentials printed.')
secret = unlocked.stdout.decode().strip()
env = os.environ.copy()
env.update({
    'JAVA_HOME': '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    'ANDROID_SDK_ROOT': str(Path.home() / 'Library/Android/sdk'),
    'ANDROID_RELEASE_STORE_FILE': str(key),
    'ANDROID_RELEASE_STORE_PASSWORD': secret,
    'ANDROID_RELEASE_KEY_ALIAS': 'agentic-wear',
    'ANDROID_RELEASE_KEY_PASSWORD': secret,
    'AGENTIC_WEAR_VERSION_CODE': str(args.version_code),
    'AGENTIC_WEAR_VERSION_NAME': args.version_name,
    'AGENTIC_WEAR_RELEASE_CHANNEL': 'Private',
    'AGENTIC_WEAR_PRIVATE_UPDATES_ONLY': 'true',
    'AGENTIC_WEAR_LIVE_VOICE_RUNTIME': 'true',
    'AGENTIC_WEAR_LIVE_VOICE_ABI': 'armeabi-v7a,arm64-v8a',
    'AGENTIC_WEAR_LIVE_VOICE_RESOURCE_LANGUAGES': 'en,de',
})
# Push wake-ups need the Firebase client config. wear/build.gradle.kts reads it from
# local.properties or the environment; private builds 70-75 were made without it.
local_props = repo / 'local.properties'
firebase_configured = 'AGENTIC_WEAR_FIREBASE_CONFIG_FILE' in os.environ or (
    local_props.is_file() and any(line.split('=', 1)[0].strip().startswith('AGENTIC_WEAR_FIREBASE_')
                                  for line in local_props.read_text().splitlines()))
print(f'Firebase push config: {"present" if firebase_configured else "ABSENT (push wake-ups disabled)"}')

log_dir = repo / 'build' / 'private-release'
log_dir.mkdir(parents=True, exist_ok=True)
log_path = log_dir / f'{args.version_code}.log'
with log_path.open('w') as log:
    result = subprocess.run(['./gradlew', '--offline', ':wear:testDebugUnitTest', ':wear:assembleRelease',
        ':wear:lintRelease', '--no-configuration-cache', '--no-daemon', '-Dorg.gradle.workers.max=2',
        '-Dorg.gradle.jvmargs=-Xmx2g', '--console=plain'], cwd=repo, env=env, stdout=log, stderr=log)
print(f'Private signed build/checks exit: {result.returncode} (log: {log_path})')
print(f'APK: {repo / "wear/build/outputs/apk/release/wear-release.apk"}')
sys.exit(result.returncode)
