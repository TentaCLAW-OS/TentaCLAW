import { useEffect } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { VerticalTabs } from '@/components/layout/VerticalTabs';
import { ContentPane } from '@/components/layout/ContentPane';
import { RightSidebar } from '@/components/layout/RightSidebar';
import { TaskLog } from '@/components/layout/TaskLog';
import { ResizeHandle } from '@/components/layout/ResizeHandle';
import { usePanelsStore } from '@/stores/panels';
import { useResizable } from '@/hooks/useResizable';

export function PanelLayout() {
  const leftWidth = usePanelsStore((s) => s.leftSidebarWidth);
  const leftCollapsed = usePanelsStore((s) => s.leftSidebarCollapsed);
  const rightCollapsed = usePanelsStore((s) => s.rightSidebarCollapsed);
  const setLeftWidth = usePanelsStore((s) => s.setLeftSidebarWidth);
  const setRightWidth = usePanelsStore((s) => s.setRightSidebarWidth);

  const leftResize = useResizable({
    direction: 'horizontal',
    initialSize: leftWidth,
    minSize: 160,
    maxSize: 400,
    onResize: setLeftWidth,
  });

  const rightResize = useResizable({
    direction: 'horizontal',
    initialSize: usePanelsStore.getState().rightSidebarWidth,
    minSize: 200,
    maxSize: 450,
    onResize: setRightWidth,
  });

  // Auto-collapse panels on narrow viewports
  useEffect(() => {
    function handleResize() {
      const w = window.innerWidth;
      const store = usePanelsStore.getState();

      if (w < 1200 && !store.rightSidebarCollapsed) {
        usePanelsStore.setState({ rightSidebarCollapsed: true });
      }
      if (w < 900 && !store.leftSidebarCollapsed) {
        usePanelsStore.setState({ leftSidebarCollapsed: true });
      }
    }

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 overflow-hidden">
        {/* Left sidebar (resource tree) */}
        {!leftCollapsed && (
          <>
            <Sidebar width={leftResize.size} />
            <ResizeHandle
              direction="horizontal"
              onMouseDown={leftResize.handleMouseDown}
              isResizing={leftResize.isResizing}
            />
          </>
        )}

        {/* Center: tabs + content */}
        <div className="flex-1 flex overflow-hidden">
          <VerticalTabs />
          <ContentPane />
        </div>

        {/* Right sidebar (context panel) */}
        {!rightCollapsed && (
          <>
            <ResizeHandle
              direction="horizontal"
              onMouseDown={rightResize.handleMouseDown}
              isResizing={rightResize.isResizing}
            />
            <RightSidebar />
          </>
        )}
      </div>

      {/* Bottom panel */}
      <TaskLog />
    </div>
  );
}
