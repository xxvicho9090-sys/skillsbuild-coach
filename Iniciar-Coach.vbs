' Abre SkillsBuild Coach en modo local integrado, sin ventana de consola.
' Inicia Ollama si hace falta, trae las novedades de GitHub y abre http://localhost:5173
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dir
sh.Run "cmd /c node scripts\local.mjs", 0, False
