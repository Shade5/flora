// This Source Code Form is subject to the terms of the Mozilla Public
// License, v2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/

import { Divider, Menu, MenuItem, PaperProps, PopoverPosition, PopoverReference } from "@mui/material";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { makeStyles } from "tss-react/mui";

import { AppSettingsTab } from "@lichtblick/suite-base/components/AppSettingsDialog/AppSettingsDialog";
import { useWorkspaceActions } from "@lichtblick/suite-base/context/Workspace/useWorkspaceActions";

const useStyles = makeStyles()({
  menuList: {
    minWidth: 200,
  },
});

type SettingsMenuProps = {
  handleClose: () => void;
  anchorEl?: HTMLElement;
  anchorReference?: PopoverReference;
  anchorPosition?: PopoverPosition;
  disablePortal?: boolean;
  open: boolean;
};

export function SettingsMenu({
  anchorEl,
  anchorReference,
  anchorPosition,
  disablePortal,
  handleClose,
  open,
}: SettingsMenuProps): JSX.Element {
  const { classes } = useStyles();
  const { t } = useTranslation("appBar");

  const { dialogActions } = useWorkspaceActions();

  const onSettingsClick = useCallback(
    (tab?: AppSettingsTab) => {
      dialogActions.preferences.open(tab);
    },
    [dialogActions.preferences],
  );



  const onDocsClick = useCallback(() => {
    window.open("https://flora.fan/docs", "_blank");
  }, []);
  const onGetDeskAppClick = useCallback(() => {
    window.open("https://github.com/flora-suite/flora/releases", "_blank");
  }, []);

  return (
    <>
      <Menu
        anchorEl={anchorEl}
        anchorReference={anchorReference}
        anchorPosition={anchorPosition}
        disablePortal={disablePortal}
        id="user-menu"
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        MenuListProps={{ className: classes.menuList, dense: true }}
        PaperProps={
          {
            "data-tourid": "user-menu",
          } as Partial<PaperProps & { "data-tourid"?: string }>
        }
      >
        <MenuItem
          onClick={() => {
            onSettingsClick();
          }}
        >
          {t("settings")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            onSettingsClick("extensions");
          }}
        >
          {t("extensions")}
        </MenuItem>
        <Divider variant="middle" />
        <MenuItem onClick={onDocsClick}>{t("documentation")}</MenuItem>
        <MenuItem onClick={onGetDeskAppClick}>{t("getDesktopApp")}</MenuItem>
      </Menu>
    </>
  );
}
