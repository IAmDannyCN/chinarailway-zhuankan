# 铁路专刊检索

把带文字层的铁路专刊 PDF 导入后，可以在浏览器中离线检索、阅读整期专刊，并跳转到原 PDF 的对应页。[下载 ZIP](https://github.com/IAmDannyCN/chinarailway-zhuankan/releases)

## 配置要求

| 用途 | 要求 |
| --- | --- |
| 搜索和阅读 | 较新的 Chrome、Edge 或 Safari，浏览器需支持 `DecompressionStream`。导入完成后可直接打开本地 HTML。 |
| 首次导入、以后更新 | Python 3.11 或更新版本。更新脚本会建立项目内的 `.venv`，并安装 `PyMuPDF==1.26.7`。首次安装依赖需要联网，后续更新可离线。 |
| 存储 | 需要存放原 PDF、生成的索引和阅读数据，以及本地 Python 环境。实际占用随专刊数量和图件多少变化。 |

发行包只包含程序。PDF 和检索数据由你在本机导入和生成。

## 首次使用

1. 下载并解压 ZIP，保留完整的目录结构。
2. 把自备的 PDF 放进 `pdf/` 或「新增专刊」。文件名应包含年份和期号，例如 `铁路客货运输2025-6.pdf`、`铁路客货运输2025-2、3.pdf`。同名 PDF 只能保留一份。
3. macOS 双击「更新专刊.command」，Windows 双击「更新专刊.cmd」。首次安装完依赖后，脚本会自动导入 PDF。
4. 看到「已入库，可查询」后，打开 `offline/index.html`，也可以双击本机系统对应的「打开查询」入口。

macOS 若无法直接运行脚本，可以在终端进入解压目录，执行 `zsh "更新专刊.command"`。也可以按下面的命令手动安装和导入。

**macOS**

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python update.py
```

**Windows（PowerShell）**

```powershell
py -3 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe update.py
```

## 阅读和更新

- 输入关键词检索。点击结果的文件名或页码，可在整期阅读中定位到命中处。
- 点「查看专刊」选择一期。左侧显示目录，右侧连续阅读；「打开原件」会打开对应的 PDF。浏览器前进、后退可恢复原有位置。
- 原图随正文显示。横置表、票据等复杂页面保留原版式，可展开「可复制文字」。需要搜索纯图片中的文字时，先给 PDF 添加 OCR 文字层，再运行更新。
- 新增或替换 PDF 后，再次运行更新脚本。程序会复用未变化且文件齐全的专刊。需要完整检查时，使用项目内的 Python 执行 `update.py --check-only`。
- 「查看专刊」里的「查看入库结果」会显示导入数量及处理提示。若更新失败，程序保留上次发布的索引，详情见 `offline/更新错误.json`。

迁移现有资料库时，请整体复制项目目录。另一台电脑可重新创建 `.venv`。Git 仓库忽略原 PDF 和生成数据，以便只分发程序。
