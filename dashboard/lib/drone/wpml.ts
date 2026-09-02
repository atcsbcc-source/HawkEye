import { strToU8, zipSync } from "fflate";
import type { Mission } from "../ops-types";
import type { GridPlan, LatLng } from "./grid";

/**
 * DJI WPML (WayPoint Markup Language) export. A `.kmz` is a zip with
 * `wpmz/template.kml` (the editable template) and `wpmz/waylines.wpml` (the
 * executable wayline). Both carry one Placemark per waypoint; the wayline adds
 * per-point speed/height and a timed-interval shoot action so the aircraft
 * exposes every `photoIntervalS` seconds along each row.
 *
 * `buildKml` is a plain KML (polygon + path) for Google Earth and importers
 * that do not understand WPML.
 */

const WPML_NS = "http://www.dji.com/wpmz/1.0.2";
const KML_NS = "http://www.opengis.net/kml/2.2";
/** WPML droneEnumValue: 68 = Mavic 3 series (consumer); 77 = Mavic 3 Enterprise. */
const DRONE_ENUM = 68;
const PAYLOAD_ENUM = 66;

export function xmlEscape(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&apos;",
  );
}

const coord = ([lat, lng]: LatLng, alt?: number) =>
  alt === undefined
    ? `${lng.toFixed(7)},${lat.toFixed(7)}`
    : `${lng.toFixed(7)},${lat.toFixed(7)},${alt}`;

/** Filename-safe mission name. */
export function safeFileName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "mission";
}

function missionConfig(plan: GridPlan): string {
  return `  <wpml:missionConfig>
    <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
    <wpml:finishAction>goHome</wpml:finishAction>
    <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
    <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
    <wpml:takeOffSecurityHeight>${Math.min(plan.altitudeM, 30)}</wpml:takeOffSecurityHeight>
    <wpml:globalTransitionalSpeed>${Math.max(plan.speedMps, 10)}</wpml:globalTransitionalSpeed>
    <wpml:droneInfo>
      <wpml:droneEnumValue>${DRONE_ENUM}</wpml:droneEnumValue>
      <wpml:droneSubEnumValue>0</wpml:droneSubEnumValue>
    </wpml:droneInfo>
    <wpml:payloadInfo>
      <wpml:payloadEnumValue>${PAYLOAD_ENUM}</wpml:payloadEnumValue>
      <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
    </wpml:payloadInfo>
  </wpml:missionConfig>`;
}

function headingParam(): string {
  return `      <wpml:waypointHeadingParam>
        <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
        <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
        <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
        <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
      </wpml:waypointHeadingParam>
      <wpml:waypointTurnParam>
        <wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode>
        <wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist>
      </wpml:waypointTurnParam>
      <wpml:useStraightLine>1</wpml:useStraightLine>`;
}

export function buildTemplateKml(mission: Mission, plan: GridPlan, now = new Date()): string {
  const ts = now.getTime();
  const placemarks = plan.waypoints
    .map(
      (wp, i) => `    <Placemark>
      <Point><coordinates>${coord(wp)}</coordinates></Point>
      <wpml:index>${i}</wpml:index>
      <wpml:ellipsoidHeight>${plan.altitudeM}</wpml:ellipsoidHeight>
      <wpml:height>${plan.altitudeM}</wpml:height>
      <wpml:useGlobalHeight>1</wpml:useGlobalHeight>
      <wpml:useGlobalSpeed>1</wpml:useGlobalSpeed>
      <wpml:useGlobalHeadingParam>1</wpml:useGlobalHeadingParam>
      <wpml:useGlobalTurnParam>1</wpml:useGlobalTurnParam>
      <wpml:useStraightLine>1</wpml:useStraightLine>
    </Placemark>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="${KML_NS}" xmlns:wpml="${WPML_NS}">
<Document>
  <wpml:author>HawkEye</wpml:author>
  <wpml:createTime>${ts}</wpml:createTime>
  <wpml:updateTime>${ts}</wpml:updateTime>
${missionConfig(plan)}
  <Folder>
    <name>${xmlEscape(mission.name)}</name>
    <wpml:templateType>waypoint</wpml:templateType>
    <wpml:templateId>0</wpml:templateId>
    <wpml:waylineCoordinateSysParam>
      <wpml:coordinateMode>WGS84</wpml:coordinateMode>
      <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
      <wpml:positioningType>GPS</wpml:positioningType>
    </wpml:waylineCoordinateSysParam>
    <wpml:autoFlightSpeed>${plan.speedMps}</wpml:autoFlightSpeed>
    <wpml:globalHeight>${plan.altitudeM}</wpml:globalHeight>
    <wpml:caliFlightEnable>0</wpml:caliFlightEnable>
    <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
    <wpml:globalWaypointHeadingParam>
      <wpml:waypointHeadingMode>followWayline</wpml:waypointHeadingMode>
      <wpml:waypointHeadingAngle>0</wpml:waypointHeadingAngle>
      <wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint>
      <wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode>
    </wpml:globalWaypointHeadingParam>
    <wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:globalWaypointTurnMode>
    <wpml:globalUseStraightLine>1</wpml:globalUseStraightLine>
${placemarks}
  </Folder>
</Document>
</kml>
`;
}

export function buildWaylinesWpml(mission: Mission, plan: GridPlan): string {
  const last = plan.waypoints.length - 1;
  const placemarks = plan.waypoints
    .map((wp, i) => {
      // Start the timed shoot at the beginning of each row (even index), stop at its end.
      const isRowStart = i % 2 === 0;
      const action = isRowStart
        ? `      <wpml:actionGroup>
        <wpml:actionGroupId>${i}</wpml:actionGroupId>
        <wpml:actionGroupStartIndex>${i}</wpml:actionGroupStartIndex>
        <wpml:actionGroupEndIndex>${Math.min(i + 1, last)}</wpml:actionGroupEndIndex>
        <wpml:actionGroupMode>sequence</wpml:actionGroupMode>
        <wpml:actionTrigger>
          <wpml:actionTriggerType>multipleTiming</wpml:actionTriggerType>
          <wpml:actionTriggerParam>${plan.photoIntervalS}</wpml:actionTriggerParam>
        </wpml:actionTrigger>
        <wpml:action>
          <wpml:actionId>${i}</wpml:actionId>
          <wpml:actionActuatorFunc>takePhoto</wpml:actionActuatorFunc>
          <wpml:actionActuatorFuncParam>
            <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>
            <wpml:fileSuffix>${xmlEscape(safeFileName(mission.name))}_r${Math.floor(i / 2)}</wpml:fileSuffix>
          </wpml:actionActuatorFuncParam>
        </wpml:action>
      </wpml:actionGroup>`
        : "";
      return `    <Placemark>
      <Point><coordinates>${coord(wp)}</coordinates></Point>
      <wpml:index>${i}</wpml:index>
      <wpml:executeHeight>${plan.altitudeM}</wpml:executeHeight>
      <wpml:height>${plan.altitudeM}</wpml:height>
      <wpml:waypointSpeed>${plan.speedMps}</wpml:waypointSpeed>
${headingParam()}
      <wpml:gimbalPitchAngle>-90</wpml:gimbalPitchAngle>
${action}
    </Placemark>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="${KML_NS}" xmlns:wpml="${WPML_NS}">
<Document>
${missionConfig(plan)}
  <Folder>
    <wpml:templateId>0</wpml:templateId>
    <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
    <wpml:waylineId>0</wpml:waylineId>
    <wpml:distance>${plan.distanceM}</wpml:distance>
    <wpml:duration>${Math.round(plan.estimatedMinutes * 60)}</wpml:duration>
    <wpml:autoFlightSpeed>${plan.speedMps}</wpml:autoFlightSpeed>
    <wpml:waylineCoordinateSysParam>
      <wpml:coordinateMode>WGS84</wpml:coordinateMode>
      <wpml:heightMode>relativeToStartPoint</wpml:heightMode>
      <wpml:positioningType>GPS</wpml:positioningType>
    </wpml:waylineCoordinateSysParam>
${placemarks}
  </Folder>
</Document>
</kml>
`;
}

/** Zip template + waylines into a DJI-importable KMZ. */
export function buildKmz(mission: Mission, plan: GridPlan, now = new Date()): Uint8Array {
  return zipSync(
    {
      "wpmz/template.kml": strToU8(buildTemplateKml(mission, plan, now)),
      "wpmz/waylines.wpml": strToU8(buildWaylinesWpml(mission, plan)),
    },
    { level: 6 },
  );
}

/** Plain KML: AO polygon + serpentine path + numbered waypoints, for Google Earth. */
export function buildKml(mission: Mission, plan: GridPlan): string {
  const ring = [...mission.polygon, mission.polygon[0]].map((p) => coord(p, 0)).join(" ");
  const path = plan.waypoints.map((p) => coord(p, plan.altitudeM)).join(" ");
  const points = plan.waypoints
    .map(
      (wp, i) => `    <Placemark>
      <name>${i}</name>
      <styleUrl>#wp</styleUrl>
      <Point><altitudeMode>relativeToGround</altitudeMode><coordinates>${coord(wp, plan.altitudeM)}</coordinates></Point>
    </Placemark>`,
    )
    .join("\n");
  const desc = xmlEscape(
    `${plan.rowCount} rows · ${plan.waypoints.length} waypoints · ${plan.distanceM} m · ~${plan.estimatedMinutes} min · ` +
      `${plan.altitudeM} m AGL · GSD ${plan.gsdCmPerPx} cm/px · ${plan.camera.name}`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="${KML_NS}">
<Document>
  <name>${xmlEscape(mission.name)}</name>
  <description>${desc}</description>
  <Style id="ao"><LineStyle><color>ff24bffb</color><width>2</width></LineStyle><PolyStyle><color>2024bffb</color></PolyStyle></Style>
  <Style id="path"><LineStyle><color>ff24bffb</color><width>3</width></LineStyle></Style>
  <Style id="wp"><IconStyle><scale>0.5</scale></IconStyle><LabelStyle><scale>0.6</scale></LabelStyle></Style>
  <Placemark>
    <name>Area of operations</name>
    <styleUrl>#ao</styleUrl>
    <Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon>
  </Placemark>
  <Placemark>
    <name>Serpentine</name>
    <styleUrl>#path</styleUrl>
    <LineString><tessellate>1</tessellate><altitudeMode>relativeToGround</altitudeMode><coordinates>${path}</coordinates></LineString>
  </Placemark>
  <Folder>
    <name>Waypoints</name>
${points}
  </Folder>
</Document>
</kml>
`;
}
