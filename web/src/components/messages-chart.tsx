import { useEffect, useRef, useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/utils';

type Day = { date: string; in: number; out: number };

const SERIES = [
    { key: 'in', label: 'Recebidas', color: 'var(--series-1)' },
    { key: 'out', label: 'Enviadas', color: 'var(--series-2)' }
] as const;

const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 28, left: 40 };
const BAR_MAX = 24;
const GAP = 2;

const weekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const parse = (date: string) => new Date(date + 'T00:00:00Z');

/** Escala "limpa": 0, 5, 10... / 0, 50, 100... */
function niceTicks(max: number) {
    if (max <= 0) return [0, 1, 2, 3, 4];
    const rough = max / 4;
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 2.5, 5, 10].map(f => f * power).find(s => s >= rough) ?? 10 * power;
    const ticks = [];
    for (let value = 0; value <= max + step * 0.999; value += step) ticks.push(Math.round(value));
    return ticks.length < 2 ? [0, Math.ceil(max)] : ticks;
}

/** Coluna com o topo arredondado (4px) e base reta. */
function columnPath(x: number, y: number, width: number, height: number) {
    const r = Math.min(4, width / 2, height);
    return `M${x},${y + height}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${x + width},${y + r}V${y + height}Z`;
}

function useWidth() {
    const ref = useRef<HTMLDivElement>(null);
    const [width, setWidth] = useState(0);
    useEffect(() => {
        if (!ref.current) return;
        const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, []);
    return [ref, width] as const;
}

export function MessagesChart({ data }: { data: Day[] }) {
    const [ref, width] = useWidth();
    const [hover, setHover] = useState<number | null>(null);
    const [asTable, setAsTable] = useState(false);

    const ticks = niceTicks(Math.max(0, ...data.flatMap(day => [day.in, day.out])));
    const top = ticks[ticks.length - 1] || 1;
    const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const band = plotWidth / Math.max(1, data.length);
    const bar = Math.min(BAR_MAX, (band * 0.6 - GAP) / 2);
    const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight;
    const total = data.reduce((sum, day) => sum + day.in + day.out, 0);
    // tooltip ao lado da faixa do dia (à direita; à esquerda perto da borda), sem cobrir as colunas
    const TOOLTIP = 176;
    const tooltipLeft = (index: number) => {
        const right = MARGIN.left + band * (index + 1) + 4;
        return right + TOOLTIP <= width ? right : Math.max(0, MARGIN.left + band * index - TOOLTIP - 4);
    };

    return (
        <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <ul className="flex gap-4 text-[13px] text-muted-foreground" aria-label="Legenda">
                    {SERIES.map(series => (
                        <li key={series.key} className="flex items-center gap-1.5">
                            <span className="size-2.5 rounded-[3px]" style={{ background: series.color }} aria-hidden />
                            {series.label}
                        </li>
                    ))}
                </ul>
                <Button variant="ghost" size="sm" onClick={() => setAsTable(value => !value)} aria-pressed={asTable}>
                    {asTable ? <BarChart3 /> : <Table2 />}
                    {asTable ? 'Ver gráfico' : 'Ver tabela'}
                </Button>
            </div>

            {asTable ? (
                <table className="w-full text-sm">
                    <thead className="text-left text-xs text-muted-foreground">
                        <tr>
                            <th className="py-2 font-medium">Dia</th>
                            {SERIES.map(series => (
                                <th key={series.key} className="py-2 text-right font-medium">
                                    {series.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="tabular-nums">
                        {data.map(day => (
                            <tr key={day.date} className="border-t">
                                <td className="py-2 first-letter:uppercase">{fullDate.format(parse(day.date))}</td>
                                <td className="py-2 text-right">{formatNumber(day.in)}</td>
                                <td className="py-2 text-right">{formatNumber(day.out)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
                    {width > 0 && (
                        <svg
                            width={width}
                            height={HEIGHT}
                            role="img"
                            aria-label={`Mensagens nos últimos ${data.length} dias: ${formatNumber(total)} no total. Use “Ver tabela” para os valores.`}
                        >
                            {ticks.map(tick => (
                                <g key={tick}>
                                    <line
                                        x1={MARGIN.left}
                                        x2={width - MARGIN.right}
                                        y1={y(tick)}
                                        y2={y(tick)}
                                        stroke="var(--grid)"
                                        strokeWidth={1}
                                        shapeRendering="crispEdges"
                                    />
                                    <text
                                        x={MARGIN.left - 8}
                                        y={y(tick)}
                                        dy="0.32em"
                                        textAnchor="end"
                                        className="fill-muted-foreground text-[11px] tabular-nums"
                                    >
                                        {formatNumber(tick)}
                                    </text>
                                </g>
                            ))}
                            {data.map((day, index) => {
                                const center = MARGIN.left + band * index + band / 2;
                                return (
                                    <g key={day.date}>
                                        {hover === index && (
                                            <rect
                                                x={center - band / 2 + 2}
                                                y={MARGIN.top}
                                                width={band - 4}
                                                height={plotHeight}
                                                rx={6}
                                                className="fill-muted"
                                            />
                                        )}
                                        {SERIES.map((series, seriesIndex) => {
                                            const value = day[series.key];
                                            const height = (value / top) * plotHeight;
                                            const x = seriesIndex === 0 ? center - GAP / 2 - bar : center + GAP / 2;
                                            return value > 0 ? (
                                                <path
                                                    key={series.key}
                                                    d={columnPath(x, y(value), bar, Math.max(height, 1))}
                                                    fill={series.color}
                                                />
                                            ) : null;
                                        })}
                                        <text
                                            x={center}
                                            y={HEIGHT - 8}
                                            textAnchor="middle"
                                            className="fill-muted-foreground text-[11px] capitalize"
                                        >
                                            {index === data.length - 1
                                                ? 'hoje'
                                                : weekday.format(parse(day.date)).replace('.', '')}
                                        </text>
                                        {/* área de hover: a faixa inteira do dia, maior que as barras */}
                                        <rect
                                            x={center - band / 2}
                                            y={MARGIN.top}
                                            width={band}
                                            height={plotHeight + MARGIN.bottom}
                                            fill="transparent"
                                            onMouseEnter={() => setHover(index)}
                                            onTouchStart={() => setHover(index)}
                                        />
                                    </g>
                                );
                            })}
                        </svg>
                    )}
                    {hover !== null && data[hover] && (
                        <div
                            className="pointer-events-none absolute top-0 z-10 w-44 rounded-lg border bg-card p-3 text-[13px] shadow-md"
                            style={{ left: tooltipLeft(hover) }}
                            role="status"
                        >
                            <p className="mb-2 font-medium first-letter:uppercase">
                                {fullDate.format(parse(data[hover].date))}
                            </p>
                            {SERIES.map(series => (
                                <p
                                    key={series.key}
                                    className="flex items-center justify-between gap-3 text-muted-foreground"
                                >
                                    <span className="flex items-center gap-1.5">
                                        <span
                                            className="size-2 rounded-[2px]"
                                            style={{ background: series.color }}
                                            aria-hidden
                                        />
                                        {series.label}
                                    </span>
                                    <span className="font-medium text-foreground tabular-nums">
                                        {formatNumber(data[hover][series.key])}
                                    </span>
                                </p>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
