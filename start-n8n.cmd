@echo off
rem Starts n8n for the autostart task (docs/SETUP.md section 6).
rem An antivirus that scans HTTPS (Kaspersky, for example) re-signs api.openai.com with its own
rem certificate. Node only trusts it through the Windows certificate store; without this line
rem every LLM call fails with "SSL Issue".
set NODE_USE_SYSTEM_CA=1
npx -y n8n@2.45.5
