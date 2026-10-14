# Minimal tester avatar omission path

Redistribution rights for the eight bundled dot_*.png character images are not documented here. Do not infer rights from the Apache license for project code or from OpenAI compatibility.

A reviewable minimal variant can remove the eight wear/src/main/res/drawable-nodpi/dot_*.png files, remove their drawable references from DotAvatar, and replace DotFigure's painterResource/Image layer with the app's existing code-drawn neutral orb/circle. Preserve Dot routing, labels, saved selection and microphone/permission state. Existing avatar names can remain only as migrated stored preferences; present a neutral Dot label instead of offering character portraits. Do not generate derivative lookalikes.

This variant is a proposed omission, not applied by this source correction. It needs one signed watch rebuild and focused resource/compile/signature checks; no broad emulator pass is requested. Until that variant is prepared or image rights are established, the present APK is not an avatar-rights-cleared redistribution candidate. Omitting artwork does not settle separate platform distribution permission.
