import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 补丁名称与版本
const PATCH_NAME = 'DrawIQ 性能优化与窗口自适应补丁';
const PATCH_VERSION = '1.0';

console.log('========================================');
console.log('  ' + PATCH_NAME + ' (v' + PATCH_VERSION + ')');
console.log('========================================');

// 需要覆盖的文件映射表
// key: 解包后 app.asar 内的相对路径
// value: 本脚本旁 patch-files 目录下对应的补丁文件名
const PATCH_FILES = {
    'src/main/disableUpdate.js': 'disableUpdate.js',
    'src/main/electron.js': 'electron.js',
    'src/main/electron-preload.js': 'electron-preload.js',
    'drawio/src/main/webapp/index.html': 'index.html',
    'drawio/src/main/webapp/js/bootstrap.js': 'bootstrap.js',
    'drawio/src/main/webapp/js/diagramly/ElectronApp.js': 'ElectronApp.js'
};

// 1. 自动定位官方安装的 app.asar
function locateAsar() {
    var username = os.userInfo().username;

    // 候选路径列表
    var candidatePaths = [
        // 个人单用户安装路径
        path.join(process.env.LOCALAPPDATA || ('C:\\Users\\' + username + '\\AppData\\Local'), 'Programs', 'draw.io', 'resources', 'app.asar'),
        // 系统管理员全员安装路径 (64位系统)
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'draw.io', 'resources', 'app.asar'),
        // 系统管理员全员安装路径 (32位系统运行在64位下)
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'draw.io', 'resources', 'app.asar'),
        // 当前执行目录下的相对路径 (方便将补丁拷入 resources 目录下执行)
        path.resolve('./app.asar'),
        path.resolve('./resources/app.asar')
    ];

    for (var i = 0; i < candidatePaths.length; i++) {
        if (fs.existsSync(candidatePaths[i])) {
            console.log('[+] 成功定位官方 app.asar: ' + candidatePaths[i]);
            return candidatePaths[i];
        }
    }

    return null;
}

// 2. 定位补丁文件目录
function locatePatchFilesDir() {
    // 优先级: 与脚本同级的 patch-files 目录
    var patchDir = path.join(__dirname, 'patch-files');
    if (fs.existsSync(patchDir)) {
        return patchDir;
    }
    console.error('[-] 错误: 未找到 patch-files 目录。');
    console.error('    请确保 patch-files 文件夹与此脚本位于同一目录下。');
    console.error('    期望路径: ' + patchDir);
    return null;
}

// 核心执行逻辑
async function run() {
    // 验证 patch-files 目录
    var patchDir = locatePatchFilesDir();
    if (!patchDir) {
        process.exit(1);
    }

    // 验证所有补丁源文件是否存在
    var missingFiles = [];
    for (var relPath in PATCH_FILES) {
        var patchFileName = PATCH_FILES[relPath];
        var patchFilePath = path.join(patchDir, patchFileName);
        if (!fs.existsSync(patchFilePath)) {
            missingFiles.push(patchFileName);
        }
    }
    if (missingFiles.length > 0) {
        console.error('[-] 错误: patch-files 目录中缺少以下补丁文件:');
        missingFiles.forEach(function(f) { console.error('    - ' + f); });
        process.exit(1);
    }
    console.log('[+] 补丁源文件验证通过，共 ' + Object.keys(PATCH_FILES).length + ' 个文件待注入。');

    // 定位 app.asar
    var asarPath = locateAsar();
    if (!asarPath) {
        console.error('[-] 错误: 未能在系统中定位到官方 draw.io 安装目录下的 app.asar。');
        console.error('    请确认你已安装官方 draw.io 程序。');
        console.error('    或者请将此补丁脚本及 patch-files 文件夹复制到 draw.io 安装目录下的 "resources" 文件夹中运行。');
        process.exit(1);
    }

    var resourcesDir = path.dirname(asarPath);
    var backupPath = path.join(resourcesDir, 'app.asar.bak');
    var tempExtractDir = path.join(resourcesDir, 'app-extracted-temp-' + Date.now());

    // 3. 备份原始 app.asar
    if (!fs.existsSync(backupPath)) {
        console.log('[+] 正在备份原始 app.asar 至: ' + backupPath);
        try {
            fs.copyFileSync(asarPath, backupPath);
        } catch (e) {
            if (e.code === 'EPERM' || e.code === 'EACCES') {
                console.error('');
                console.error('[-] 权限不足！无法写入目标目录: ' + resourcesDir);
                console.error('    draw.io 安装在系统保护目录下，需要管理员权限才能修改。');
                console.error('');
                console.error('    解决方法: 请右键点击"命令提示符"或"PowerShell"，选择"以管理员身份运行"，');
                console.error('    然后重新执行: node drawio-patcher.js');
                process.exit(1);
            }
            throw e;
        }
        console.log('[+] 备份完成。');
    } else {
        console.log('[*] 提示: 备份文件 app.asar.bak 已存在，跳过备份步骤。');
    }

    try {
        // 4. 使用 npx 解包 app.asar
        console.log('[+] 正在解包 app.asar，这可能需要几秒钟...');
        execSync('npx --yes @electron/asar extract "' + asarPath + '" "' + tempExtractDir + '"', { stdio: 'inherit' });
        console.log('[+] 解包成功。临时目录: ' + tempExtractDir);

        // 5. 逐个覆盖补丁文件
        console.log('[+] 开始应用优化补丁修改...');

        for (var relPath in PATCH_FILES) {
            var patchFileName = PATCH_FILES[relPath];
            var sourcePath = path.join(patchDir, patchFileName);
            var targetPath = path.join(tempExtractDir, relPath);

            // 确保目标目录存在
            var targetDir = path.dirname(targetPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // 读取补丁文件并写入目标
            var content = fs.readFileSync(sourcePath, 'utf8');
            fs.writeFileSync(targetPath, content, 'utf8');
            console.log('    [OK] ' + relPath + ' <- ' + patchFileName);
        }

        console.log('[+] 全部 ' + Object.keys(PATCH_FILES).length + ' 个补丁文件写入完毕。');

        // 6. 重新封包为 app.asar
        console.log('[+] 正在重新封包为 app.asar...');
        execSync('npx --yes @electron/asar pack "' + tempExtractDir + '" "' + asarPath + '"', { stdio: 'inherit' });
        console.log('[OK] 封包成功，补丁已成功应用！');

    } catch (err) {
        console.error('[-] 发生错误:', err);
        console.log('[*] 尝试从备份中还原原版 app.asar...');
        if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, asarPath);
            console.log('[OK] 还原备份成功。');
        }
    } finally {
        // 7. 清理临时解包目录
        if (fs.existsSync(tempExtractDir)) {
            console.log('[+] 清理临时解包目录...');
            fs.rmSync(tempExtractDir, { recursive: true, force: true });
        }
    }

    console.log('');
    console.log('[*] 补丁执行完成。现在你可以打开你的 draw.io 程序享受极速启动与无边框体验了！');
    console.log('[*] 如需还原官方版本，请将 app.asar.bak 重命名为 app.asar 即可。');
}

run();
