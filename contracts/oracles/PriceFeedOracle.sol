/* Copyright (C) 2020 NexusMutual.io
  This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.
  This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
  You should have received a copy of the GNU General Public License
    along with this program.  If not, see http://www.gnu.org/licenses/ */

pragma solidity ^0.5.0;

contract PriceFeedOracle {

    address constant public ETH = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    /**
     * @dev Returns the amount of ether in wei that are equivalent to 1 unit (10 ** decimals) of asset
     * @param asset quoted currency
     * @return price in ether
     */
    function getETHToAssetRate(address asset) external view returns (uint) {

        if (asset == ETH) {
            return 1 ether;
        }

        // set max uint as the price for any unknown asset
        // should result in a revert when accidentally swapping from/to it
        return uint(-1);
    }

    /**
     * @dev Returns the amount of ether in wei that are equivalent to 1 unit (10 ** decimals) of asset
     * @param asset quoted currency
     * @return price in ether
     */
    function getAssetToETHRate(address asset) external view returns (uint) {

        if (asset == ETH) {
            return 1 ether;
        }

        // set max uint as the price for any unknown asset
        // should result in a revert when accidentally swapping from/to it
        return uint(- 1);
    }
}
