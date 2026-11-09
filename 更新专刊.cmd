@echo off
chcp 65001 >nul
setlocal
pushd "%~dp0" || exit /b 1
set "PYTHONDONTWRITEBYTECODE=1"
if exist ".venv\Scripts\python.exe" goto ready
set "python_launcher=py -3"
where py >nul 2>nul
if not errorlevel 1 goto prepare
set "python_launcher=python"
where python >nul 2>nul
if errorlevel 1 goto need_python
:prepare
%python_launcher% -c "import sys; sys.exit(sys.version_info < (3, 11))"
if errorlevel 1 goto need_python
echo 首次使用：准备本地更新工具。
%python_launcher% -m venv .venv
if errorlevel 1 goto failed
:ready
".venv\Scripts\python.exe" -c "import importlib.metadata as m; assert m.version('PyMuPDF') == '1.26.7'" >nul 2>nul
if not errorlevel 1 goto update
echo 首次安装 PDF 处理工具需要联网；以后更新可离线运行。
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
:update
echo 更新 pdf 和“新增专刊”文件夹中的全部专刊。
".venv\Scripts\python.exe" update.py
if errorlevel 1 goto failed
start "" "%CD%\offline\index.html"
echo 更新完成。
pause
popd
exit /b 0
:need_python
echo 请先安装 Python 3.11 或更新版本。查询现有专刊不需要安装 Python。
pause
popd
exit /b 1
:failed
echo 更新未发布，原有索引保留。请查看上方提示。
pause
popd
exit /b 1
