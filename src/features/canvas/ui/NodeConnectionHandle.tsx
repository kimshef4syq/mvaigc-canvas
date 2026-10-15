import { useRef, type ComponentProps, type CSSProperties, type PointerEvent } from 'react';
import { Handle, Position, useNodeId, useStore } from '@xyflow/react';
import { Plus } from 'lucide-react';

type NodeConnectionHandleProps = ComponentProps<typeof Handle>;

/** Keep the graph anchor fixed while offering a generous, magnetic edge target. */
export function NodeConnectionHandle({
  className,
  position = Position.Right,
  style,
  children,
  onPointerMove,
  onPointerLeave,
  ...props
}: NodeConnectionHandleProps) {
  const nodeId = useNodeId();
  const height = useStore((state) => nodeId ? state.nodeLookup.get(nodeId)?.measured.height : undefined);
  const zoom = useStore((state) => state.transform[2]);
  const ref = useRef<HTMLDivElement>(null);
  const horizontal = position === Position.Left || position === Position.Right;
  const direction = position === Position.Left ? -1 : 1;
  // Leave the corners free for resizing; limit expansion when zoomed far out.
  const scale = 1 / Math.max(0.5, zoom);
  const reach = Math.max(8, (height ?? 120) - 40 * scale);

  const moveIndicator = (event: PointerEvent<HTMLDivElement>) => {
    if (event.buttons !== 0 || event.pointerType === 'touch') return;
    const handle = ref.current;
    if (!handle) return;
    const rect = handle.getBoundingClientRect();
    const x = (event.clientX - rect.left - rect.width / 2) / zoom;
    const y = (event.clientY - rect.top - rect.height / 2) / zoom;
    const followX = Math.max(-10 * scale, Math.min(10 * scale, (x - direction * 28 * scale) * 0.4));
    const followY = Math.max(-reach / 2, Math.min(reach / 2, y));
    handle.style.setProperty('--connection-indicator-x', `${direction * 28 * scale + followX}px`);
    handle.style.setProperty('--connection-indicator-y', `${followY}px`);
  };

  return (
    <Handle
      {...props}
      ref={ref}
      position={position}
      className={`${className ?? ''} ${horizontal ? 'canvas-connection-handle' : ''}`}
      style={{
        '--connection-reach': `${reach}px`,
        '--connection-scale': scale,
        '--connection-indicator-x': `${direction * 28 * scale}px`,
        ...style,
      } as CSSProperties}
      onPointerMove={(event) => {
        if (horizontal) moveIndicator(event);
        onPointerMove?.(event);
      }}
      onPointerLeave={(event) => {
        if (event.buttons === 0) {
          ref.current?.style.removeProperty('--connection-indicator-y');
        }
        onPointerLeave?.(event);
      }}
    >
      {horizontal && (
        <span className="canvas-connection-indicator" aria-hidden="true">
          <Plus />
        </span>
      )}
      {children}
    </Handle>
  );
}
