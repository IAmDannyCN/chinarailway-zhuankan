#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PYTHONDONTWRITEBYTECODE=1
if [[ ! -x .venv/bin/python ]]; then
  if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>/dev/null; then
    echo "更新工具需要 Python 3.11 或更新版本。查询现有专刊不需要安装 Python。"
    read "?按回车关闭窗口。"
    exit 1
  fi
  echo "首次使用：准备本地更新工具。"
  python3 -m venv .venv || exit 1
fi
if ! .venv/bin/python -c "import importlib.metadata as m; assert m.version('PyMuPDF') == '1.26.7'; assert m.version('Pillow') == '13.0.0'" 2>/dev/null; then
  echo "首次安装 PDF 处理工具需要联网；以后更新可离线运行。"
  .venv/bin/python -m pip install -r requirements.txt || exit 1
fi
echo "更新 pdf 和“新增专刊”文件夹中的全部专刊。"
.venv/bin/python update.py
result=$?
if [[ $result -eq 0 ]]; then
  open "offline/index.html"
else
  echo "更新未发布，原有索引保留。请查看上方提示。"
fi
echo "按回车关闭窗口。"
read
exit $result
