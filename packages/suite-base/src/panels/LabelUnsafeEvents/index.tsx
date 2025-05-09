import { Box, Button, TextField, Typography, Stack, Paper } from "@mui/material";
import { ReactElement, useState } from "react";
import Panel from "../../components/Panel";
import { PanelConfig, SaveConfig } from "@lichtblick/suite-base/types/panels";
import { useMessagePipeline, useMessagePipelineGetter } from "@lichtblick/suite-base/components/MessagePipeline";
import { Time, fromSec, add as addTimes } from "@lichtblick/rostime";

// Define the Segment interface
interface Segment {
  id: string;
  caption: string;
  startTime: number;
  endTime: number;
}

// Mock data for initial segments
const mockSegments: Segment[] = [
  { id: "1", caption: "Person crossing street", startTime: 10, endTime: 15 },
  { id: "2", caption: "Car turning without signal", startTime: 25, endTime: 30 },
  { id: "3", caption: "Near collision at intersection", startTime: 45, endTime: 52 },
];

function LabelUnsafeEventsPanelInner(): ReactElement {
  // Get the messagePipeline getter function to access latest state in callbacks
  const messagePipeline = useMessagePipelineGetter();

  // State for the segments
  const [segments, setSegments] = useState<Segment[]>(mockSegments);
  const [unsavedChanges, setUnsavedChanges] = useState<boolean>(false);

  // Handler for updating a segment's caption
  const handleCaptionChange = (id: string, newCaption: string) => {
    setSegments(prevSegments =>
      prevSegments.map(segment =>
        segment.id === id ? { ...segment, caption: newCaption } : segment
      )
    );
    setUnsavedChanges(true);
  };

  // Handler for updating a segment's start time
  const handleStartTimeChange = (id: string, newStartTime: string) => {
    const timeValue = parseFloat(newStartTime);
    if (!isNaN(timeValue)) {
      setSegments(prevSegments =>
        prevSegments.map(segment =>
          segment.id === id ? { ...segment, startTime: timeValue } : segment
        )
      );
      setUnsavedChanges(true);
    }
  };

  // Handler for updating a segment's end time
  const handleEndTimeChange = (id: string, newEndTime: string) => {
    const timeValue = parseFloat(newEndTime);
    if (!isNaN(timeValue)) {
      setSegments(prevSegments =>
        prevSegments.map(segment =>
          segment.id === id ? { ...segment, endTime: timeValue } : segment
        )
      );
      setUnsavedChanges(true);
    }
  };

  // Handler for seek button
  const handleSeek = (seekSeconds: number) => {
    // Get the latest state including seekPlayback function and startTime
    const {
      seekPlayback,
      playerState: { activeData: { startTime } = {} },
    } = messagePipeline();

    // Return early if seekPlayback or startTime is not available
    if (!seekPlayback || !startTime) {
      console.warn("Seek functionality not available - missing seekPlayback or startTime");
      return;
    }

    console.log(`Seeking to ${seekSeconds} seconds from startTime:`, startTime);

    // Calculate the absolute time by adding the seek seconds to the startTime
    const seekTime = addTimes(startTime, fromSec(seekSeconds));

    // Perform the seek
    seekPlayback(seekTime);
  };

  // Handler for save button
  const handleSave = () => {
    // This will be implemented later to save segments to storage/backend
    console.log("Saving segments:", segments);
    setUnsavedChanges(false);
  };

  return (
    <Box p={2} height="100%" overflow="auto">
      <Typography variant="h6" gutterBottom>
        Unsafe Events
      </Typography>

      <Stack spacing={2} mb={3}>
        {segments.map((segment) => (
          <Paper key={segment.id} elevation={2} sx={{ p: 2 }}>
            <Stack spacing={2}>
              <TextField
                fullWidth
                label="Caption"
                value={segment.caption}
                onChange={(e) => handleCaptionChange(segment.id, e.target.value)}
                variant="outlined"
                size="small"
              />

              <Box display="flex" gap={2} alignItems="center">
                <TextField
                  label="Start (sec)"
                  type="number"
                  value={segment.startTime}
                  onChange={(e) => handleStartTimeChange(segment.id, e.target.value)}
                  variant="outlined"
                  size="small"
                  inputProps={{ step: 0.1 }}
                  sx={{ width: 120 }}
                />

                <TextField
                  label="End (sec)"
                  type="number"
                  value={segment.endTime}
                  onChange={(e) => handleEndTimeChange(segment.id, e.target.value)}
                  variant="outlined"
                  size="small"
                  inputProps={{ step: 0.1 }}
                  sx={{ width: 120 }}
                />

                <Button
                  variant="outlined"
                  onClick={() => handleSeek(segment.startTime)}
                  sx={{ ml: 'auto' }}
                >
                  Seek
                </Button>
              </Box>
            </Stack>
          </Paper>
        ))}
      </Stack>

      <Box display="flex" justifyContent="flex-end">
        <Button
          variant="contained"
          color="primary"
          onClick={handleSave}
          disabled={!unsavedChanges}
        >
          Save Changes
        </Button>
      </Box>
    </Box>
  );
}

interface LabelUnsafeEventsConfig extends PanelConfig {
  // You can add panel-specific config options here
  segments?: Segment[];
}

const LabelUnsafeEventsPanel = ({
  config,
  saveConfig,
}: {
  config: LabelUnsafeEventsConfig;
  saveConfig: SaveConfig<LabelUnsafeEventsConfig>;
}) => {
  return <LabelUnsafeEventsPanelInner />;
};

LabelUnsafeEventsPanel.panelType = "LabelUnsafeEvents";
LabelUnsafeEventsPanel.defaultConfig = {
  segments: mockSegments,
};

export default Panel(LabelUnsafeEventsPanel);
