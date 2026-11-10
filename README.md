# 铁路专刊检索

把带文字层的铁路专刊 PDF 导入后，可以在浏览器中离线检索、阅读整期专刊，并跳转到原 PDF 的对应页。[下载 ZIP](https://github.com/IAmDannyCN/chinarailway-zhuankan/releases)

## 配置要求

| 用途 | 要求 |
| --- | --- |
| 搜索和阅读 | 较新的 Chrome、Edge 或 Safari，浏览器需支持 `DecompressionStream`。导入完成后可直接打开本地 HTML。 |
| 首次导入、以后更新 | Python 3.11 或更新版本。脚本会在项目内建立 `.venv`，安装 PyMuPDF 和 Pillow。首次安装依赖需要联网，后续更新可离线。 |
| 存储 | 需要存放原 PDF、文字索引、无损压缩的原版面和本地 Python 环境。原版面占用随页数、版式和图件变化。 |

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

- 输入关键词检索。点击结果的文件名或页码，可在整期阅读中定位到命中处。在「筛选」里选择「按 PDF 原页检索」，可跨同页篇目查找 PDF 文字，在原版面上高亮命中。
- 点「查看专刊」选择一期。左侧显示目录，右侧连续阅读；「打开原件」会打开对应的 PDF。浏览器前进、后退可恢复原有位置。
- 可识别的正文保留原行与缩进，表格保留格线对应的行、列和合并单元格。复杂版面随阅读显示原页图像，可展开「可复制文字」或打开对应 PDF 页。纯图片上的字需要先给原 PDF 添加 OCR 文字层，再运行更新。
- 票价费率、品名代码、货运办理和修改订正等表格按原表头区分列。列车时刻表若在同一格内纵向排列多站时刻，阅读页保留原版面和站时对应关系。
- 目录中可识别的文件落款日期会显示在篇名下方。
- 新增或替换 PDF 后，再次运行更新脚本。程序会复用未变化且文件齐全的专刊。需要完整检查时，使用项目内的 Python 执行 `update.py --check-only`。
- 「查看专刊」里的「查看入库结果」会显示导入数量及处理提示。若更新失败，程序保留上次发布的索引，详情见 `offline/更新错误.json`。

迁移现有资料库时，请整体复制项目目录。另一台电脑可重新创建 `.venv`。Git 仓库忽略原 PDF 和生成数据，以便只分发程序。
