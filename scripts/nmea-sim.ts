// A Condor stand-in: broadcasts NMEA over TCP 4353, so the whole chain can be exercised
// without the simulator running — on a Linux box, in CI, on a plane.
//
//   bun run scripts/nmea-sim.ts            # then connect VOLPLANE to 127.0.0.1:4353
//   bun run scripts/nmea-sim.ts 4353 --circle    # circle in a thermal, drifting with the wind
//
// Straight mode is Phase 0's claim: the altitude goes up, the ground goes up faster, the AGL
// must FALL. Circle mode is Phase 2's: the glider circles in lift and DRIFTS with a wind this
// script knows exactly — from 270° at 20 km/h — so the app's ESTIMATED wind can be judged
// against the truth, which is the whole point of a simulator bench (ACQ-014).
const PORT = Number(process.argv[2] ?? 4353);
const CIRCLE = process.argv.includes('--circle');
const WIND_U = 5.56;                       // m/s eastward drift = wind FROM 270° at 20 km/h

const cs = (body: string): string => {
  let c = 0;
  for (let i = 1; i < body.length; i++) c ^= body.charCodeAt(i);
  return `${body}*${c.toString(16).toUpperCase().padStart(2, '0')}`;
};
const dm = (d: number): string => {
  const deg = Math.floor(Math.abs(d));
  return `${String(deg).padStart(2, '0')}${((Math.abs(d) - deg) * 60).toFixed(4).padStart(7, '0')}`;
};

Bun.listen({
  hostname: '0.0.0.0',
  port: PORT,
  socket: {
    // An instrument talks; it does not listen. But Bun.listen wants a `data` handler, and a
    // real instrument link is bidirectional anyway (some accept commands), so: accept and ignore.
    data() { /* the flight computer has nothing to say back, yet */ },
    open(socket) {
      console.log(CIRCLE
        ? 'client connected — circling in a thermal, drifting on a 270°/20 km/h wind'
        : 'client connected — flying east, climbing');
      let t = 12 * 3600, lat = 47.0, lon = 8.0, alt = 1500, tick = 0;
      const timer = setInterval(() => {
        t += 1; tick += 1;
        let plat = lat, plon = lon;
        if (CIRCLE) {
          // A 100 m circle every 36 s around a centre the WIND carries east. The estimator
          // reads the drift off the circles; this script knows the answer it must find.
          alt += 1.5;
          const a = 2 * Math.PI * tick / 36;
          const cLon = 8.0 + WIND_U * tick / (111320 * Math.cos(47 * Math.PI / 180));
          plon = cLon + 100 * Math.cos(a) / (111320 * Math.cos(47 * Math.PI / 180));
          plat = 47.0 + 100 * Math.sin(a) / 111320;
        } else {
          lon += 0.0002; alt += 1.5;   // ~15 m/s east, +1.5 m/s
          plon = lon;
        }
        const hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = t % 60;
        const hms = `${String(hh).padStart(2, '0')}${String(mm).padStart(2, '0')}${String(ss).padStart(2, '0')}.00`;
        socket.write(
          cs(`$GPGGA,${hms},${dm(plat)},N,0${dm(plon)},E,1,08,1.0,${alt.toFixed(1)},M,47.0,M,,`) + '\r\n'
          + cs(`$GPRMC,${hms},A,${dm(plat)},N,0${dm(plon)},E,30.0,090.0,110726,,,A`) + '\r\n'
          + cs(`$LXWP0,Y,110.0,${(alt - 20).toFixed(1)},1.5,,,,,,090,270,20.0`) + '\r\n',
        );
      }, 1000);
      (socket as unknown as { timer?: ReturnType<typeof setInterval> }).timer = timer;
    },
    close(socket) {
      clearInterval((socket as unknown as { timer?: ReturnType<typeof setInterval> }).timer);
      console.log('client gone');
    },
  },
});
console.log(`NMEA on tcp://0.0.0.0:${PORT} — point VOLPLANE at it (this is what Condor does)`);
