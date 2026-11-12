@echo off
rem ============================================================
rem  Compile .tex with the local TeX Live (XeLaTeX engine).
rem  Runs twice so the table of contents gets correct page numbers.
rem
rem    build.bat              -> compile every .tex in this folder
rem    build.bat myfile.tex   -> compile just myfile.tex
rem ============================================================
setlocal
set "TL=%TEXLIVE_ROOT%\bin\windows"  & rem 先设置环境变量 TEXLIVE_ROOT
pushd "%~dp0"
if "%~1"=="" (
  for %%F in (*.tex) do call :one "%%~nxF"
) else (
  call :one "%~1"
)
popd
echo.
echo Finished. PDF files are in this folder.
pause
exit /b 0

:one
echo.
echo === %~1 ===
"%TL%\xelatex.exe" -interaction=nonstopmode -halt-on-error "%~1"
"%TL%\xelatex.exe" -interaction=nonstopmode -halt-on-error "%~1"
if exist "%~n1.pdf" (echo OK   : %~n1.pdf) else (echo FAILED: %~1 -- check %~n1.log)
exit /b 0
