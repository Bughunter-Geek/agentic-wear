#!/usr/bin/env python3
"""Prepare public assets from the exact accepted private APK; never build or publish."""
import argparse, hashlib, json, os, re, shutil, subprocess
from pathlib import Path

def require(condition, message):
    if not condition: raise ValueError(message)

SIGNER = 'bc70f367781d453b8dd22eb4daf5b735c291656a0d64137f974094aefdb6cda8'

def prepare(apk, private_receipt, acceptance, tag, out, sdk):
    require(re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+-alpha', tag), 'Expected Alpha prerelease tag')
    raw = apk.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    require(private_receipt.get('private') is True and private_receipt.get('published') is True, 'Private publication receipt required')
    require(acceptance.get('accepted') is True and acceptance.get('physicalWatch') is True, 'Physical Watch acceptance required')
    require(private_receipt.get('sha256') == acceptance.get('sha256') == digest, 'Private/accepted APK hash mismatch')
    code = private_receipt['versionCode']; name = private_receipt['versionName']
    require(acceptance.get('versionCode') == code and private_receipt.get('apkSize') == len(raw), 'Receipt version/size mismatch')
    source = private_receipt.get('sourceCommit', '')
    require(re.fullmatch(r'[0-9a-f]{40}', source), 'Source commit receipt required')
    tools = sdk / 'build-tools/37.0.0'
    env = os.environ.copy()
    env.setdefault('JAVA_HOME', '/Applications/Android Studio.app/Contents/jbr/Contents/Home')
    cert = subprocess.check_output([str(tools/'apksigner'), 'verify', '--print-certs', str(apk)], env=env, text=True)
    require(re.findall(r'certificate SHA-256 digest:\s*([a-f0-9]{64})', cert) == [SIGNER], 'Unexpected signer')
    badging = subprocess.check_output([str(tools/'aapt2'), 'dump', 'badging', str(apk)], text=True)
    package = re.search(r"package: name='([^']+)' versionCode='([^']+)' versionName='([^']+)'", badging)
    require(package and package.groups() == ('io.github.sirbughunter.agenticwear', str(code), name), 'APK package/version mismatch')
    require(tag == f'v{name}-alpha', 'Tag must match the accepted version')
    out.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(apk, out/'agentic-wear.apk')
    manifest = dict(versionCode=code, versionName=name,
        apkUrl=f'https://github.com/Bughunter-Geek/agentic-wear/releases/download/{tag}/agentic-wear.apk',
        sha256=digest, apkSize=len(raw))
    (out/'update.json').write_text(json.dumps(manifest, indent=2)+'\n')
    (out/'promotion-receipt.json').write_text(json.dumps(dict(manifest, sourceCommit=source,
        privateAccepted=True, rebuilt=False, published=False, signerSha256=SIGNER), indent=2)+'\n')
    return manifest

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('apk', 'private-receipt', 'acceptance', 'tag', 'out'): parser.add_argument('--'+key, required=True)
    parser.add_argument('--sdk', default=str(Path.home()/'Library/Android/sdk'))
    args = parser.parse_args()
    try:
        result = prepare(Path(args.apk), json.loads(Path(args.private_receipt).read_text()),
            json.loads(Path(args.acceptance).read_text()), args.tag, Path(args.out), Path(args.sdk))
        print(json.dumps(dict(result, prepared=True, rebuilt=False, published=False)))
    except (AssertionError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        raise SystemExit(f'Promotion preparation stopped: {error}')
