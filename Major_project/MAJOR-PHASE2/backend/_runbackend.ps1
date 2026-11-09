# _runbackend.ps1 - start the BioChain backend under nodemon from the backend folder.
Set-Location -Path $PSScriptRoot
node src/server.js *>> migration-backend.log
