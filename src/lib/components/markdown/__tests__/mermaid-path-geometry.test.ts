import { describe, expect, it } from 'vitest';
import {
  alignMermaidOpenArrowheads,
  buildRoundedOrthogonalPath,
  buildFlowchartDecisionBranchPoints,
  buildFlowchartDecisionReturnPoints,
  buildFlowchartFeedbackLanePoints,
  buildGroupedReturnLanePoints,
  chooseFlowchartFeedbackTargetX,
  chooseLabelSegment,
  diamondBoundaryPort,
  diamondRayIntersection,
  measuredClusterHeaderHeight,
  preferClearStraightRoute,
  replacePathTerminal,
  routeOrthogonalAroundObstacles,
  simplifyOrthogonalPoints,
  snapOrthogonalTerminals,
} from '../mermaid-path-geometry';

type TestPoint = { x: number; y: number };
type TestBounds = TestPoint & { width: number; height: number };

function expectOrthogonalRoute(points: TestPoint[]) {
  expect(
    points.slice(0, -1).every((point, index) => {
      const next = points[index + 1];
      return Math.abs(point.x - next.x) < 0.001 || Math.abs(point.y - next.y) < 0.001;
    }),
  ).toBe(true);
}

function segmentEntersBounds(start: TestPoint, end: TestPoint, bounds: TestBounds) {
  if (Math.abs(start.x - end.x) < 0.001) {
    return (
      start.x > bounds.x &&
      start.x < bounds.x + bounds.width &&
      Math.max(start.y, end.y) > bounds.y &&
      Math.min(start.y, end.y) < bounds.y + bounds.height
    );
  }
  if (Math.abs(start.y - end.y) >= 0.001) return true;
  return (
    start.y > bounds.y &&
    start.y < bounds.y + bounds.height &&
    Math.max(start.x, end.x) > bounds.x &&
    Math.min(start.x, end.x) < bounds.x + bounds.width
  );
}

function expectRouteAvoids(points: TestPoint[], bounds: TestBounds) {
  expect(
    points
      .slice(0, -1)
      .some((point, index) => segmentEntersBounds(point, points[index + 1], bounds)),
  ).toBe(false);
}

describe('Mermaid path terminal geometry', () => {
  describe('clear straight boundary ports', () => {
    const diamond = { x: 0, y: 0, width: 100, height: 100 };
    const source = { point: diamondBoundaryPort(diamond, 'right', 8), side: 'right' as const };
    const target = {
      point: { x: 280, y: 60 },
      side: 'left' as const,
      range: [38, 72] as [number, number],
    };
    const jog = [source.point, { x: 150, y: 58 }, { x: 150, y: 60 }, target.point];

    it('slides a free rectangular target onto the assigned diamond port corridor', () => {
      const routed = preferClearStraightRoute(jog, source, target, []);
      expect(routed).toEqual([source.point, { x: 280, y: 58 }]);
      expect(routed[0]).toEqual(diamondBoundaryPort(diamond, 'right', 8));
      expect(jog.at(-1)).toEqual({ x: 280, y: 60 });
    });

    it('uses the same boundary rule for upward connections', () => {
      const start = { point: { x: 28, y: 200 }, side: 'top' as const };
      const end = {
        point: { x: 30, y: 20 },
        side: 'bottom' as const,
        range: [10, 50] as [number, number],
      };
      expect(
        preferClearStraightRoute(
          [start.point, { x: 28, y: 100 }, { x: 30, y: 100 }, end.point],
          start,
          end,
          [],
        ),
      ).toEqual([start.point, { x: 28, y: 20 }]);
    });

    it.each([
      { name: 'node', bounds: { x: 150, y: 45, width: 30, height: 30 } },
      { name: 'group', bounds: { x: 120, y: 40, width: 100, height: 50 } },
      { name: 'label clearance', bounds: { x: 150, y: 63, width: 30, height: 12 } },
    ])('keeps the safe detour when the direct corridor meets a $name', ({ bounds }) => {
      const detour = [
        source.point,
        { x: 100, y: 58 },
        { x: 100, y: 100 },
        { x: 260, y: 100 },
        { x: 260, y: 60 },
        target.point,
      ];
      const routed = preferClearStraightRoute(detour, source, target, [bounds]);
      expect(routed).toEqual(detour);
      expectOrthogonalRoute(routed);
      expectRouteAvoids(routed, bounds);
    });

    it.each([
      { start: { x: 120, y: 58 }, end: { x: 240, y: 58 } },
      { start: { x: 120, y: 64 }, end: { x: 240, y: 64 } },
      { start: { x: 170, y: 40 }, end: { x: 170, y: 80 } },
    ])('does not merge with, crowd, or cross an occupied route', (occupied) => {
      expect(preferClearStraightRoute(jog, source, target, [], [occupied])).toEqual(jog);
    });

    it('does not consume the neighboring target port capacity', () => {
      expect(
        preferClearStraightRoute(jog, source, target, [], [], [], [{ x: 280, y: 43 }]),
      ).toEqual(jog);
      expect(
        preferClearStraightRoute(jog, source, target, [], [], [], [{ x: 280, y: 42 }]),
      ).toHaveLength(2);
    });

    it('does not move fixed ports or move beyond the target boundary range', () => {
      expect(preferClearStraightRoute(jog, source, { ...target, range: undefined }, [])).toEqual(
        jog,
      );
      expect(preferClearStraightRoute(jog, source, { ...target, range: [60, 72] }, [])).toEqual(
        jog,
      );
    });

    it('preserves separate diamond ports while using a clear straight lane', () => {
      const occupied = [
        diamondBoundaryPort(diamond, 'right', -8),
        diamondBoundaryPort(diamond, 'bottom', 10),
      ];
      const routed = preferClearStraightRoute(jog, source, target, [], [], occupied);
      expect(routed).toHaveLength(2);
      expect(new Set([...occupied, routed[0]].map(({ x, y }) => `${x},${y}`)).size).toBe(3);
    });

    it('does not reverse a port normal or collapse a same-side return', () => {
      expect(preferClearStraightRoute(jog, source, { ...target, side: 'right' }, [])).toEqual(jog);
      expect(
        preferClearStraightRoute(jog, source, { ...target, point: { x: 20, y: 60 } }, []),
      ).toEqual(jog);
    });

    it('finds an available straight lane between occupied port slots', () => {
      const start = {
        point: { x: 100, y: 58 },
        side: 'right' as const,
        range: [30, 90] as [number, number],
      };
      const end = { ...target, range: [30, 90] as [number, number] };
      const ports = [
        { x: 280, y: 45 },
        { x: 280, y: 90 },
      ];
      const routed = preferClearStraightRoute(jog, start, end, [], [], [], ports);
      expect(routed).toHaveLength(2);
      expect(routed[0].y).toBe(routed[1].y);
      expect(routed[1].y).toBeGreaterThanOrEqual(61);
      expect(routed[1].y).toBeLessThanOrEqual(74);
    });
  });

  it('replaces directional wedges with compact open chevrons', () => {
    document.body.innerHTML = `<svg><defs>
      <marker id="diagram-pointEnd"><path d="M 0 0 L 10 5 L 0 10 z" /></marker>
      <marker id="diagram-pointStart"><path d="M 10 0 L 0 5 L 10 10 z" /></marker>
    </defs></svg>`;
    const svg = document.querySelector('svg') as unknown as SVGSVGElement;

    alignMermaidOpenArrowheads(svg);

    const markers = [...svg.querySelectorAll<SVGMarkerElement>('marker')];
    expect(markers.map((marker) => marker.dataset.diagramChevron)).toEqual(['true', 'true']);
    expect(markers.map((marker) => marker.querySelector('path')?.getAttribute('fill'))).toEqual([
      'none',
      'none',
    ]);
    expect(markers.map((marker) => marker.querySelector('path')?.getAttribute('d'))).toEqual([
      'M 3.5 0.5 L 6.5 3.5 L 3.5 6.5',
      'M 3.5 0.5 L 0.5 3.5 L 3.5 6.5',
    ]);
    expect(
      markers.every((marker) => {
        const values = marker
          .querySelector('path')!
          .getAttribute('d')!
          .match(/-?(?:\d+(?:\.\d*)?|\.\d+)/g)!
          .map(Number);
        const [x1, y1, tipX, tipY, x2, y2] = values;
        const first = { x: x1 - tipX, y: y1 - tipY };
        const second = { x: x2 - tipX, y: y2 - tipY };
        return Math.abs(first.x * second.x + first.y * second.y) < 0.001;
      }),
    ).toBe(true);
  });

  it('preserves directed route terminals while aligning arrowheads', () => {
    document.body.innerHTML = `<svg><defs>
      <marker id="diagram-pointEnd"><path /></marker>
    </defs><path id="route" d="M0,0L20,0" marker-end="url(#diagram-pointEnd)" /></svg>`;
    const svg = document.querySelector('svg') as unknown as SVGSVGElement;
    const route = svg.querySelector<SVGPathElement>('#route')!;

    alignMermaidOpenArrowheads(svg);

    expect(route.getAttribute('d')).toBe('M0,0L20,0');
  });

  it('preserves rounded corners while replacing the final endpoint', () => {
    const path = 'M 4 6 L 20 6 Q 26 6 26 12 L 26 30';

    expect(replacePathTerminal(path, { x: 26, y: 31 })).toBe('M 4 6 L 20 6 Q 26 6 26 12 L 26 31');
  });

  it('preserves comma-separated route coordinates', () => {
    expect(replacePathTerminal('M1,2L8,9', { x: 10.5, y: -3 })).toBe('M1,2L10.5,-3');
  });

  it('removes a terminal line that collapses onto a rounded corner endpoint', () => {
    expect(replacePathTerminal('M 4 6 Q 20 6 26 12 L 25 11', { x: 26, y: 12 })).toBe(
      'M 4 6 Q 20 6 26 12',
    );
  });

  it('does not rewrite a closed path without a terminal coordinate pair', () => {
    expect(replacePathTerminal('M 1 2 L 3 4 Z', { x: 5, y: 6 })).toBeNull();
  });

  it('removes duplicate points and collinear jogs before rounding', () => {
    expect(
      simplifyOrthogonalPoints([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 },
    ]);
    expect(
      buildRoundedOrthogonalPath([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
      ]),
    ).toBe('M 0 0 L 34 0 Q 40 0 40 6 L 40 30');
  });

  it('detours orthogonal routes outside unrelated node clearance', () => {
    const routed = routeOrthogonalAroundObstacles(
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      [{ x: 30, y: 30, width: 40, height: 40 }],
      8,
    );

    expect(routed).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: 22 },
      { x: 22, y: 22 },
      { x: 22, y: 78 },
      { x: 50, y: 78 },
      { x: 50, y: 100 },
    ]);
  });

  it('selects the unoccupied side when obstacle detours have equal length', () => {
    const routed = routeOrthogonalAroundObstacles(
      [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      [{ x: 30, y: 30, width: 40, height: 40 }],
      8,
      [{ start: { x: 22, y: 22 }, end: { x: 22, y: 78 } }],
    );

    expect(routed.some((point) => point.x === 78)).toBe(true);
    expect(routed.some((point) => point.x === 22)).toBe(false);
  });

  it('keeps snapped cardinal ports connected by orthogonal segments', () => {
    const points = snapOrthogonalTerminals(
      [
        { x: 0, y: 20 },
        { x: 0, y: 80 },
      ],
      { x: 40, y: 30 },
      { x: 10, y: 110 },
      true,
    );

    expect(points[0]).toEqual({ x: 40, y: 30 });
    expect(points.at(-1)).toEqual({ x: 10, y: 110 });
    expect(
      points.slice(1).every((point, index) => {
        const previous = points[index];
        return point.x === previous.x || point.y === previous.y;
      }),
    ).toBe(true);
  });

  it('replaces a shared diagonal bend with two orthogonal bends', () => {
    const points = snapOrthogonalTerminals(
      [
        { x: 40, y: 30 },
        { x: 120, y: 110 },
        { x: 70, y: 110 },
      ],
      { x: 40, y: 30 },
      { x: 70, y: 110 },
      false,
    );

    expect(points).toEqual([
      { x: 40, y: 30 },
      { x: 55, y: 30 },
      { x: 55, y: 110 },
      { x: 70, y: 110 },
    ]);
  });

  it('rebuilds a route that retains an interior diagonal', () => {
    const points = snapOrthogonalTerminals(
      [
        { x: 180, y: 270 },
        { x: 120, y: 270 },
        { x: 225, y: 390 },
        { x: 230, y: 390 },
      ],
      { x: 180, y: 270 },
      { x: 230, y: 390 },
      false,
    );

    expect(points).toEqual([
      { x: 180, y: 270 },
      { x: 205, y: 270 },
      { x: 205, y: 390 },
      { x: 230, y: 390 },
    ]);
  });

  it('chooses one label segment with enough measured capacity', () => {
    const route = [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
      { x: 120, y: 40 },
      { x: 120, y: 80 },
    ];

    expect(chooseLabelSegment(route, { width: 80, height: 20 })).toMatchObject({
      index: 1,
      horizontal: true,
      capacity: 120,
    });
    expect(
      chooseLabelSegment(route, { width: 80, height: 20 }, [
        { start: { x: 0, y: 40 }, end: { x: 120, y: 40 } },
      ]),
    ).toMatchObject({ index: 0, horizontal: false, capacity: 40 });
  });

  it('reserves the measured cluster title plus a stable content gap', () => {
    expect(measuredClusterHeaderHeight(36.2)).toBe(93);
    expect(measuredClusterHeaderHeight(12)).toBe(74);
  });

  it('intersects rays with the rhombus boundary instead of its rectangular bounds', () => {
    const bounds = { x: 10, y: 20, width: 100, height: 80 };
    const center = { x: 60, y: 60 };

    expect(diamondRayIntersection(center, { x: 50, y: 40 }, bounds)).toEqual({ x: 85, y: 80 });
    expect(diamondRayIntersection(center, { x: 0, y: -40 }, bounds)).toEqual({ x: 60, y: 20 });
  });

  it('fans contested ports out along the diamond boundary', () => {
    const bounds = { x: 0, y: 0, width: 100, height: 80 };
    const ports = [
      diamondBoundaryPort(bounds, 'right', -8),
      diamondBoundaryPort(bounds, 'right', 8),
      diamondBoundaryPort(bounds, 'top', -10),
      diamondBoundaryPort(bounds, 'top', 10),
    ];

    expect(new Set(ports.map(({ x, y }) => `${x},${y}`)).size).toBe(4);
    expect(
      ports.every(
        ({ x, y }) => Math.abs(Math.abs(x - 50) / 50 + Math.abs(y - 40) / 40 - 1) < 0.001,
      ),
    ).toBe(true);
    expect(diamondBoundaryPort(bounds, 'right')).toEqual({ x: 100, y: 40 });
  });

  it('builds top and right decision branch lanes from cardinal apexes', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 };
    const occupied = [source, { x: 200, y: 0, width: 80, height: 160 }];

    expect(
      buildFlowchartDecisionBranchPoints(
        source,
        { x: 200, y: 0, width: 80, height: 40 },
        'upper',
        occupied,
      ),
    ).toEqual([
      { x: 50, y: 0 },
      { x: 50, y: -32 },
      { x: 240, y: -32 },
      { x: 240, y: 0 },
    ]);
    expect(
      buildFlowchartDecisionBranchPoints(
        source,
        { x: 200, y: 120, width: 80, height: 40 },
        'lower',
        occupied,
      ),
    ).toEqual([
      { x: 100, y: 50 },
      { x: 150, y: 50 },
      { x: 150, y: 140 },
      { x: 200, y: 140 },
    ]);
  });

  it('keeps decision returns on a separate outer lane', () => {
    expect(
      buildFlowchartDecisionReturnPoints(
        { x: 200, y: 120, width: 80, height: 40 },
        { x: 0, y: 0, width: 100, height: 100 },
        [
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 200, y: 120, width: 80, height: 40 },
        ],
      ),
    ).toEqual([
      { x: 240, y: 160 },
      { x: 240, y: 192 },
      { x: 50, y: 192 },
      { x: 50, y: 100 },
    ]);
    expect(
      buildFlowchartDecisionReturnPoints(
        { x: 10, y: 200, width: 80, height: 40 },
        { x: 10, y: 0, width: 80, height: 40 },
        [
          { x: 10, y: 0, width: 80, height: 40 },
          { x: 10, y: 200, width: 80, height: 40 },
        ],
      ),
    ).toEqual([
      { x: 50, y: 240 },
      { x: 50, y: 40 },
    ]);
    expect(
      buildFlowchartDecisionReturnPoints(
        { x: 10, y: 200, width: 80, height: 40 },
        { x: 0, y: 0, width: 100, height: 100 },
        [
          { x: 0, y: 0, width: 100, height: 100 },
          { x: 10, y: 200, width: 80, height: 40 },
        ],
        true,
      ),
    ).toEqual([
      { x: 50, y: 240 },
      { x: 50, y: 252 },
      { x: -28, y: 252 },
      { x: -28, y: 50 },
      { x: 0, y: 50 },
    ]);
  });

  it('separates compact decision branches around a vertically stacked diamond', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 };
    const target = { x: 10, y: 200, width: 80, height: 40 };
    const occupied = [source, target];

    const upper = buildFlowchartDecisionBranchPoints(source, target, 'upper', occupied, true);
    expect(upper).toEqual([
      { x: 50, y: 100 },
      { x: 50, y: 200 },
    ]);
    expectOrthogonalRoute(upper);
    expectRouteAvoids(upper, source);
    expectRouteAvoids(upper, target);
    expect(buildFlowchartDecisionBranchPoints(source, target, 'lower', occupied, true)).toEqual([
      { x: 100, y: 50 },
      { x: 132, y: 50 },
      { x: 132, y: 220 },
      { x: 90, y: 220 },
    ]);
  });

  it('keeps compact stacked branches orthogonal when the target is offset', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 };
    const target = { x: 140, y: 200, width: 80, height: 40 };

    const points = buildFlowchartDecisionBranchPoints(
      source,
      target,
      'upper',
      [source, target],
      true,
    );

    expectOrthogonalRoute(points);
    expectRouteAvoids(points, source);
    expectRouteAvoids(points, target);
  });

  it('routes compact stacked branches around an aligned intervening shape', () => {
    const source = { x: 0, y: 0, width: 100, height: 100 };
    const target = { x: 10, y: 200, width: 80, height: 40 };
    const obstacle = { x: 35, y: 130, width: 30, height: 40 };

    const points = buildFlowchartDecisionBranchPoints(
      source,
      target,
      'upper',
      [source, obstacle, target],
      true,
    );

    expectOrthogonalRoute(points);
    expectRouteAvoids(points, source);
    expectRouteAvoids(points, obstacle);
    expectRouteAvoids(points, target);
  });

  it('builds a bounded feedback lane with centered perpendicular terminals', () => {
    const points = buildFlowchartFeedbackLanePoints(
      { x: -43, y: 734, width: 86, height: 42 },
      { x: -58, y: 0, width: 116, height: 42 },
      [
        { x: -78, y: 0, width: 156, height: 776 },
        { x: 0, y: 42, width: 126, height: 526 },
      ],
    );

    expect(points).toEqual([
      { x: 43, y: 755 },
      { x: 154, y: 755 },
      { x: 154, y: 804 },
      { x: -106, y: 804 },
      { x: -106, y: 54 },
      { x: 0, y: 54 },
      { x: 0, y: 42.25 },
    ]);
  });

  it('keeps a compact feedback lane close to its painted routes', () => {
    const points = buildFlowchartFeedbackLanePoints(
      { x: -36, y: 568, width: 72, height: 42 },
      { x: -41, y: 142, width: 82, height: 42 },
      [
        { x: -83, y: 42, width: 177, height: 526 },
        { x: -52, y: 0, width: 104, height: 610 },
      ],
      true,
    );

    expect(points).toEqual([
      { x: 36, y: 589 },
      { x: 64, y: 589 },
      { x: 64, y: 622 },
      { x: -95, y: 622 },
      { x: -95, y: 196 },
      { x: 0, y: 196 },
      { x: 0, y: 184.25 },
    ]);
  });

  it('separates a feedback target only when the same boundary side has competing ports', () => {
    const target = { x: 0, y: 0, width: 100, height: 40 };

    expect(chooseFlowchartFeedbackTargetX(target, [34, 50, 66])).toBe(26);
    expect(chooseFlowchartFeedbackTargetX(target, [26, 42, 58, 74])).toBe(50);
    expect(chooseFlowchartFeedbackTargetX(target, [])).toBe(50);
  });

  it('builds grouped return routes on an external lane with side-center ports', () => {
    expect(
      buildGroupedReturnLanePoints(
        { x: 20, y: 400, width: 60, height: 40 },
        { x: 10, y: 20, width: 80, height: 40 },
        [
          { x: 0, y: 0, width: 120, height: 460 },
          { x: 10, y: 20, width: 80, height: 40 },
        ],
      ),
    ).toEqual([
      { x: 80, y: 420 },
      { x: 148, y: 420 },
      { x: 148, y: 40 },
      { x: 90, y: 40 },
    ]);

    expect(
      buildGroupedReturnLanePoints(
        { x: 20, y: 400, width: 60, height: 40 },
        { x: 10, y: 20, width: 80, height: 40 },
        [{ x: 0, y: 0, width: 120, height: 460 }],
        true,
      ),
    ).toEqual([
      { x: 80, y: 420 },
      { x: 138, y: 420 },
      { x: 138, y: 40 },
      { x: 90, y: 40 },
    ]);
  });
});
