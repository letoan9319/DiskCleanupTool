; DiskCleanupTool Windows NSIS Installer Hooks
; Registers / cleans up Windows Explorer context menu entries in HKCU (safe for both per-user and per-machine installs)

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\DiskCleanupTool" "" "Scan with DiskCleanupTool"
  WriteRegStr HKCU "Software\Classes\Directory\shell\DiskCleanupTool" "Icon" "$INSTDIR\DiskCleanupTool.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\DiskCleanupTool\command" "" '"$INSTDIR\DiskCleanupTool.exe" "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\DiskCleanupTool" "" "Scan with DiskCleanupTool"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\DiskCleanupTool" "Icon" "$INSTDIR\DiskCleanupTool.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\DiskCleanupTool\command" "" '"$INSTDIR\DiskCleanupTool.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\DiskCleanupTool" "" "Scan with DiskCleanupTool"
  WriteRegStr HKCU "Software\Classes\Drive\shell\DiskCleanupTool" "Icon" "$INSTDIR\DiskCleanupTool.exe,0"
  WriteRegStr HKCU "Software\Classes\Drive\shell\DiskCleanupTool\command" "" '"$INSTDIR\DiskCleanupTool.exe" "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\DiskCleanupTool"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\DiskCleanupTool"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\DiskCleanupTool"
!macroend
