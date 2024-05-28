import { BigInt} from "@graphprotocol/graph-ts"

export function getHourStartTimestamp(timestamp: BigInt): BigInt {
    let secondsInAnHour = 3600
    let hour = timestamp.toI32() / secondsInAnHour
    return BigInt.fromI32(hour * secondsInAnHour)
}