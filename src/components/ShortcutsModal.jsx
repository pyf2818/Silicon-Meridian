import { ICONS } from '../constants/index.jsx';

export default function ShortcutsModal({
  showShortcuts,
  setShowShortcuts,
}) {
  if (!showShortcuts) return null;
  return (
    <div className="modal-overlay" onClick={() => setShowShortcuts(false)}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header"><h3>快捷键</h3><button className="modal-close" onClick={() => setShowShortcuts(false)}>{ICONS.x}</button></div>
        <div className="modal-body">
          <div className="shortcuts-list">
            <div className="shortcut-group">全局</div>
            <div className="shortcut-row"><kbd>Ctrl K</kbd><span>命令面板</span></div>
            <div className="shortcut-row"><kbd>?</kbd><span>显示快捷键帮助</span></div>
            <div className="shortcut-row"><kbd>Esc</kbd><span>关闭弹窗 / 命令面板</span></div>

            <div className="shortcut-group">页面跳转（按 G 后接下列键）</div>
            <div className="shortcut-row"><kbd>G H</kbd><span>AI 工作站（首页）</span></div>
            <div className="shortcut-row"><kbd>G D</kbd><span>今日汇报 / 推荐</span></div>
            <div className="shortcut-row"><kbd>G A</kbd><span>全部动态</span></div>
            <div className="shortcut-row"><kbd>G G</kbd><span>GitHub 热门</span></div>
            <div className="shortcut-row"><kbd>G S</kbd><span>股市动向</span></div>
            <div className="shortcut-row"><kbd>G U</kbd><span>素材管理</span></div>
            <div className="shortcut-row"><kbd>G W</kbd><span>无限画布</span></div>
            <div className="shortcut-row"><kbd>G C</kbd><span>用户广场</span></div>
            <div className="shortcut-row"><kbd>G P</kbd><span>用户画像</span></div>
            <div className="shortcut-row"><kbd>G M</kbd><span>竞争监测</span></div>

            <div className="shortcut-group">资讯列表（全部 / 趋势页）</div>
            <div className="shortcut-row"><kbd>J</kbd><span>下一条资讯</span></div>
            <div className="shortcut-row"><kbd>K</kbd><span>上一条资讯</span></div>
            <div className="shortcut-row"><kbd>O</kbd><span>打开原文链接</span></div>
            <div className="shortcut-row"><kbd>S</kbd><span>收藏/取消收藏</span></div>
            <div className="shortcut-row"><kbd>1</kbd><span>紧凑视图</span></div>
            <div className="shortcut-row"><kbd>2</kbd><span>标准视图</span></div>
            <div className="shortcut-row"><kbd>3</kbd><span>卡片视图</span></div>
            <div className="shortcut-row"><kbd>Esc</kbd><span>关闭资讯预览抽屉</span></div>

            <div className="shortcut-group">无限画布</div>
            <div className="shortcut-row"><kbd>Ctrl Z</kbd><span>撤销节点变更</span></div>
            <div className="shortcut-row"><kbd>Ctrl Shift Z</kbd> / <kbd>Ctrl Y</kbd><span>重做</span></div>
            <div className="shortcut-row"><kbd>F</kbd><span>适应视图</span></div>
            <div className="shortcut-row"><kbd>0</kbd><span>重置视图</span></div>
            <div className="shortcut-row"><kbd>双击空白</kbd><span>就地创建节点</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
